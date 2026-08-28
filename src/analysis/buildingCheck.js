import { airportLayers, olsAirportLayers } from '../config/airportLayers.js';
import { loadGeoJson } from '../data/loader.js';
import { createAirport3DContext, createSurfaceHeightResolver } from '../cesium/surfaceGeometry.js';
import polygonClipping from 'polygon-clipping';

let dataPromise;

const surfaceTitlesAz = {
  conical: 'Konusvari səth',
  innerHorizontal: 'Daxili üfüqi səth',
  approach03: 'RWY 03 yanaşma səthi',
  approach21: 'RWY 21 yanaşma səthi',
  takeoff03: 'RWY 03 qalxma səthi',
  takeoff21: 'RWY 21 qalxma səthi',
  transitional: 'Keçid səthi',
};

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
        layerTitle: localizeSurfaceTitle(config.id, config.title),
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
          localizeSurfaceTitle(config.id, config.title),
        ));
      }
    });
  });

  const maximumPenetrationMeters = intersections.reduce(
    (maximum, item) => Math.max(maximum, item.violation ? -item.clearance : 0),
    0,
  );

  return {
    coordinates: closedFootprint,
    heightMeters,
    buildingTopElevation,
    intersections,
    intersectsAnySurface: intersections.length > 0,
    violation: intersections.some((item) => item.violation),
    maximumPenetrationMeters,
    surfaceReport: olsAirportLayers.map((surface) => createSurfaceReport(surface, intersections)),
    conflictPolygons,
  };
}

function createSurfaceReport(surface, intersections) {
  const matches = intersections.filter((item) => item.layerId === surface.id);
  if (!matches.length) {
    return {
      layerId: surface.id,
      layerTitle: localizeSurfaceTitle(surface.id, surface.title),
      overlapsFootprint: false,
      status: 'KƏNARDA',
      message: 'Daxil edilən mövqedə bina bu səthin əhatə dairəsinə düşmür.',
    };
  }
  const limitingElevation = Math.min(...matches.map((item) => item.limitingElevation));
  const maximumHeight = Math.max(0, limitingElevation - 1.5);
  const violation = matches.some((item) => item.violation);
  const penetrationMeters = Math.max(0, ...matches.map((item) => -item.clearance));
  return {
    layerId: surface.id,
    layerTitle: localizeSurfaceTitle(surface.id, surface.title),
    overlapsFootprint: true,
    limitingElevation,
    maximumHeight,
    violation,
    penetrationMeters,
    status: violation ? 'POZUNTU' : 'TƏHLÜKƏSİZ',
    message: violation
      ? `Bina OLS səthini ${penetrationMeters.toFixed(2)} m aşır.`
      : `İcazə verilən maksimum bina hündürlüyü ${maximumHeight.toFixed(2)} m-dir.`,
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
  return polygonClipping.union(...pieces).map((coordinates) => {
    const surfaceCoordinates = coordinates.map((ring) => ring.map(([longitude, latitude]) => [
      longitude,
      latitude,
      heightAt([longitude, latitude]),
    ]));
    const surfaceElevations = surfaceCoordinates.flat().map((coordinate) => coordinate[2]).filter(Number.isFinite);
    const penetrationMeters = surfaceElevations.length
      ? Math.max(0, buildingTopElevation - Math.min(...surfaceElevations))
      : 0;

    return { layerId, layerTitle, coordinates, surfaceCoordinates, penetrationMeters };
  });
}

function localizeSurfaceTitle(layerId, fallback) {
  return surfaceTitlesAz[layerId] ?? fallback;
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
    buildingSamples.filter((point) => pointInPolygon(point, rings)).forEach((point) => samples.push(point));
    rings.flat().filter((point) => pointInRing(point, footprint)).forEach((point) => samples.push(point));
    rings.forEach((ring) => segmentIntersections(footprint, ring).forEach((point) => samples.push(point)));
  });
  return uniquePoints(samples);
}

function pointInPolygon(point, rings) {
  return pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole));
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
