import { airportLayers, olsAirportLayers } from '../config/airportLayers.js';
import { loadGeoJson } from '../data/loader.js';
import { createAirport3DContext, createSurfaceHeightResolver } from '../cesium/surfaceGeometry.js';
import polygonClipping from 'polygon-clipping';

let dataPromise;

export async function checkBuildingFootprint(coordinates, heightMeters) {
  const data = await loadAnalysisData();
  const closedFootprint = closeRing(coordinates);
  const samplePoints = [...coordinates, polygonCentroid(coordinates)];
  const buildingTopElevation = data.context.referenceElevation + heightMeters;
  const intersections = [];
  const conflictPolygons = [];

  data.ols.forEach(({ config, geoJson }) => {
    (geoJson.features ?? []).forEach((feature, featureIndex) => {
      const overlapPoints = getOverlapSamples(closedFootprint, feature.geometry, samplePoints);
      if (!overlapPoints.length) return;

      const heightAt = createSurfaceHeightResolver(config, feature.properties, data.context, feature.geometry?.coordinates);
      const limits = overlapPoints.map((point) => heightAt(point)).filter(Number.isFinite);
      const limitingElevation = Math.min(...limits);
      const clearance = limitingElevation - buildingTopElevation;
      intersections.push({
        layerId: config.id,
        layerTitle: config.title,
        featureIndex,
        limitingElevation,
        buildingTopElevation,
        clearance,
        violation: clearance < 0,
      });
      if (clearance < 0) {
        conflictPolygons.push(...calculateConflictPolygons(
          closedFootprint,
          feature.geometry,
          heightAt,
          buildingTopElevation,
          config.id,
          config.title,
        ));
      }
    });
  });

  return {
    coordinates: closedFootprint,
    heightMeters,
    buildingTopElevation,
    intersections,
    intersectsAnySurface: intersections.length > 0,
    violation: intersections.some((item) => item.violation),
    surfaceReport: olsAirportLayers.map((surface) => createSurfaceReport(surface, intersections)),
    conflictPolygons,
  };
}

function createSurfaceReport(surface, intersections) {
  const matches = intersections.filter((item) => item.layerId === surface.id);
  if (!matches.length) {
    return {
      layerId: surface.id,
      layerTitle: surface.title,
      overlapsFootprint: false,
      status: 'OUTSIDE FOOTPRINT',
      message: 'No building height can affect this surface at the entered location.',
    };
  }
  const limitingElevation = Math.min(...matches.map((item) => item.limitingElevation));
  const maximumHeight = Math.max(0, limitingElevation - 1.5);
  const violation = matches.some((item) => item.violation);
  return {
    layerId: surface.id,
    layerTitle: surface.title,
    overlapsFootprint: true,
    limitingElevation,
    maximumHeight,
    violation,
    status: violation ? 'VIOLATION' : 'CLEAR',
    message: `Touches at ${maximumHeight.toFixed(2)} m; heights above this value violate the surface.`,
  };
}

function calculateConflictPolygons(footprint, geometry, heightAt, buildingTopElevation, layerId, layerTitle) {
  const surfaceShape = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates;
  const overlap = polygonClipping.intersection([footprint], surfaceShape);
  if (!overlap.length) return [];
  const pieces = [];

  overlap.forEach((polygon) => {
    const extent = ringExtent(polygon[0]);
    const columns = 28;
    const rows = 28;
    const cellWidth = (extent.maxX - extent.minX) / columns;
    const cellHeight = (extent.maxY - extent.minY) / rows;
    if (!cellWidth || !cellHeight) return;
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const minX = extent.minX + column * cellWidth;
        const minY = extent.minY + row * cellHeight;
        const center = [minX + cellWidth / 2, minY + cellHeight / 2];
        if (buildingTopElevation <= heightAt(center)) continue;
        const cell = [[
          [minX, minY], [minX + cellWidth, minY], [minX + cellWidth, minY + cellHeight],
          [minX, minY + cellHeight], [minX, minY],
        ]];
        const clipped = polygonClipping.intersection(polygon, cell);
        if (clipped.length) pieces.push(...clipped);
      }
    }
  });

  if (!pieces.length) return [];
  return polygonClipping.union(...pieces).map((coordinates) => ({ layerId, layerTitle, coordinates }));
}

function ringExtent(ring) {
  const xs = ring.map((coordinate) => coordinate[0]);
  const ys = ring.map((coordinate) => coordinate[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

async function loadAnalysisData() {
  if (!dataPromise) {
    dataPromise = Promise.all(airportLayers.map(async (config) => ({ config, geoJson: await loadGeoJson(config.path) })))
      .then((layers) => {
        const byId = new Map(layers.map((entry) => [entry.config.id, entry.geoJson]));
        return {
          context: createAirport3DContext(byId.get('runway'), byId.get('runwayLine'), byId.get('innerHorizontal')),
          ols: olsAirportLayers.map((config) => ({ config, geoJson: byId.get(config.id) })),
        };
      });
  }
  return dataPromise;
}

function getOverlapSamples(footprint, geometry, buildingSamples) {
  const samples = [];
  getPolygonRings(geometry).forEach((rings) => {
    const outer = rings[0];
    buildingSamples.filter((point) => pointInRing(point, outer)).forEach((point) => samples.push(point));
    outer.filter((point) => pointInRing(point, footprint)).forEach((point) => samples.push(point));
    segmentIntersections(footprint, outer).forEach((point) => samples.push(point));
  });
  return uniquePoints(samples);
}

function getPolygonRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let first = 0, second = ring.length - 1; first < ring.length; second = first++) {
    const [xi, yi] = ring[first];
    const [xj, yj] = ring[second];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentIntersections(firstRing, secondRing) {
  const points = [];
  for (let firstIndex = 0; firstIndex < firstRing.length - 1; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < secondRing.length - 1; secondIndex += 1) {
      const point = intersectSegments(firstRing[firstIndex], firstRing[firstIndex + 1], secondRing[secondIndex], secondRing[secondIndex + 1]);
      if (point) points.push(point);
    }
  }
  return points;
}

function intersectSegments(a, b, c, d) {
  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) < 1e-14) return null;
  const t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denominator;
  const u = -((a[0] - b[0]) * (a[1] - c[1]) - (a[1] - b[1]) * (a[0] - c[0])) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] : null;
}

function polygonCentroid(points) {
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function closeRing(points) {
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

function uniquePoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    const key = `${point[0].toFixed(9)}:${point[1].toFixed(9)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
