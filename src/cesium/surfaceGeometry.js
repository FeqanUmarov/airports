const EARTH_RADIUS_M = 6378137;

export function feetToMeters(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 0.3048 : 0;
}

export function createAirport3DContext(runwayGeoJson, runwayLineGeoJson, innerHorizontalGeoJson) {
  const runwayProperties = runwayGeoJson.features?.[0]?.properties ?? {};
  const polygonCoordinates = collectPolygonCoordinates(runwayGeoJson);
  let [threshold03, threshold21] = getRunwayThresholdCenters(polygonCoordinates);
  if (!threshold03 || !threshold21) {
    const lineCoordinates = collectLineCoordinates(runwayLineGeoJson);
    [threshold03, threshold21] = farthestPair(lineCoordinates.length >= 2 ? lineCoordinates : polygonCoordinates);
  }
  const expectedBearing = Number(runwayProperties.BRG_03);

  if (Number.isFinite(expectedBearing) && angularDifference(bearingDegrees(threshold03, threshold21), expectedBearing) > 90) {
    [threshold03, threshold21] = [threshold21, threshold03];
  }

  const sourceThreshold03Elevation = feetToMeters(runwayProperties.THR03_ELEV ?? runwayProperties.THR03_ELEV_FT);
  const sourceThreshold21Elevation = feetToMeters(runwayProperties.THR21_ELEV ?? runwayProperties.THR21_ELEV_FT);
  // The current Cesium scene has imagery on an ellipsoid but no terrain model.
  // Use a local visual datum so the runway stays on the globe instead of floating
  // hundreds of metres at orthometric (AMSL) threshold elevations.
  const threshold03Elevation = 1.5;
  const threshold21Elevation = 1.5;
  const frame = createLocalFrame(threshold03, threshold21);
  const innerCoordinates = collectPolygonCoordinates(innerHorizontalGeoJson ?? { features: [] });
  const airportCenter = innerCoordinates.length ? extentCenter(innerCoordinates) : midpoint(threshold03, threshold21);

  return {
    threshold03,
    threshold21,
    threshold03Elevation,
    threshold21Elevation,
    sourceThreshold03Elevation,
    sourceThreshold21Elevation,
    referenceElevation: (threshold03Elevation + threshold21Elevation) / 2,
    headingRadians: Math.atan2(frame.ux, frame.uy),
    frame,
    airportCenter,
    runwayProperties,
  };
}

export function createSurfaceHeightResolver(config, featureProperties, context, geometry = null) {
  const properties = featureProperties ?? {};
  const innerHorizontalElevation = context.referenceElevation + number(properties.TARGET_H_M, 45);

  if (config.id === 'runway' || config.id === 'strip') {
    return (coordinate) => runwayElevationAt(coordinate, context) + (config.id === 'strip' ? 0.1 : 0);
  }

  if (config.id === 'innerHorizontal') {
    const elevation = context.referenceElevation + number(properties.HEIGHT_M, 45);
    return () => elevation;
  }

  if (config.id === 'conical') {
    const geometryCoordinates = flattenGeometryCoordinates(geometry);
    const innerRadius = geometryCoordinates.length
      ? Math.min(...geometryCoordinates.map((coordinate) => distanceMeters(context.airportCenter, coordinate)))
      : number(properties.INNER_RAD_M, 4000);
    const length = number(properties.LENGTH_M, 2000);
    const slope = number(properties.SLOPE_PCT, 5) / 100;
    const startElevation = context.referenceElevation + 45;
    const center = context.airportCenter;
    return (coordinate) => startElevation + clamp(distanceMeters(center, coordinate) - innerRadius, 0, length) * slope;
  }

  if (config.id === 'approach03' || config.id === 'approach21') {
    const runway = String(properties.RUNWAY ?? (config.id.endsWith('03') ? '03' : '21'));
    const threshold = runway === '03' ? context.threshold03 : context.threshold21;
    const baseElevation = runway === '03' ? context.threshold03Elevation : context.threshold21Elevation;
    const outwardSign = runway === '03' ? -1 : 1;
    const startDistance = number(properties.START_DIST_M, 60);
    return (coordinate) => baseElevation + approachRise(
      Math.max(0, outwardSign * alongFromThreshold(coordinate, threshold, context) - startDistance),
      properties,
    );
  }

  if (config.id === 'takeoff03' || config.id === 'takeoff21') {
    const runway = String(properties.RUNWAY ?? (config.id.endsWith('03') ? '03' : '21'));
    const threshold = runway === '03' ? context.threshold03 : context.threshold21;
    const baseElevation = runway === '03' ? context.threshold03Elevation : context.threshold21Elevation;
    const outwardSign = runway === '03' ? -1 : 1;
    const startDistance = number(properties.START_DIST_M, 240);
    const slope = number(properties.SLOPE_PCT, 2) / 100;
    return (coordinate) => baseElevation + Math.max(0, outwardSign * alongFromThreshold(coordinate, threshold, context) - startDistance) * slope;
  }

  if (config.id === 'transitional') {
    const slope = number(properties.SLOPE_PCT, 14.3) / 100;
    const targetHeight = context.referenceElevation + number(properties.TARGET_H_M, 45);
    return (coordinate) => {
      const local = projectInFrame(coordinate, context.frame);
      const along = clamp(local.x / context.frame.length, 0, 1);
      const baseElevation = interpolate(context.threshold03Elevation, context.threshold21Elevation, along);
      const lateralDistance = Math.abs(local.y);
      return Math.min(targetHeight, baseElevation + lateralDistance * slope);
    };
  }

  return () => innerHorizontalElevation;
}

export function collectLineCoordinates(geoJson) {
  return collectLineStrings(geoJson).flat();
}

export function collectLineStrings(geoJson) {
  return (geoJson.features ?? []).flatMap((feature) => lines(feature.geometry));
}

function runwayElevationAt(coordinate, context) {
  const local = projectInFrame(coordinate, context.frame);
  const ratio = clamp(local.x / context.frame.length, 0, 1);
  return interpolate(context.threshold03Elevation, context.threshold21Elevation, ratio);
}

function alongFromThreshold(coordinate, threshold, context) {
  const point = projectInFrame(coordinate, context.frame);
  const start = projectInFrame(threshold, context.frame);
  return point.x - start.x;
}

function approachRise(distance, properties) {
  const section1 = number(properties.SEC1_LEN_M, 3000);
  const section2 = number(properties.SEC2_LEN_M, 3600);
  const section3 = number(properties.SEC3_LEN_M, 8400);
  const rise1 = Math.min(distance, section1) * number(properties.SEC1_SLOPE, 2) / 100;
  const rise2 = Math.min(Math.max(distance - section1, 0), section2) * number(properties.SEC2_SLOPE, 2.5) / 100;
  const rise3 = Math.min(Math.max(distance - section1 - section2, 0), section3) * number(properties.SEC3_SLOPE, 0) / 100;
  return rise1 + rise2 + rise3;
}

function createLocalFrame(start, end) {
  const rawEnd = projectToLocalMeters(end, start);
  const length = Math.hypot(rawEnd.east, rawEnd.north) || 1;
  const ux = rawEnd.east / length;
  const uy = rawEnd.north / length;
  return { origin: start, ux, uy, length };
}

function projectToLocalMeters(coordinate, origin) {
  const latitude = ((coordinate[1] + origin[1]) / 2) * Math.PI / 180;
  const east = (coordinate[0] - origin[0]) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(latitude);
  const north = (coordinate[1] - origin[1]) * Math.PI / 180 * EARTH_RADIUS_M;
  return { east, north };
}

function projectInFrame(coordinate, frame) {
  const { east, north } = projectToLocalMeters(coordinate, frame.origin);
  return { x: east * frame.ux + north * frame.uy, y: -east * frame.uy + north * frame.ux };
}

function collectPolygonCoordinates(geoJson) {
  return (geoJson.features ?? []).flatMap((feature) => polygons(feature.geometry)).flat(2);
}

function getRunwayThresholdCenters(coordinates) {
  const unique = coordinates.filter((coordinate, index, list) => index === 0 || coordinate[0] !== list[index - 1][0] || coordinate[1] !== list[index - 1][1]);
  if (unique.length < 4) return [null, null];

  const corners = unique.slice(0, 4);
  const edges = corners.map((first, index) => {
    const second = corners[(index + 1) % corners.length];
    return { first, second, length: distanceMeters(first, second) };
  }).sort((first, second) => first.length - second.length);
  const thresholdEdges = [edges[0], edges.find((edge) => !edge.first.includes(edges[0].first[0]) && edge !== edges[0])]
    .filter(Boolean);
  if (thresholdEdges.length < 2) {
    thresholdEdges[1] = edges[1];
  }
  return thresholdEdges.map((edge) => midpoint(edge.first, edge.second));
}

function lines(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function polygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function farthestPair(coordinates) {
  if (coordinates.length < 2) return [[46.75, 39.09], [46.77, 39.11]];
  let result = [coordinates[0], coordinates[1]];
  let maxDistance = -1;
  coordinates.forEach((first, firstIndex) => coordinates.slice(firstIndex + 1).forEach((second) => {
    const distance = distanceMeters(first, second);
    if (distance > maxDistance) {
      maxDistance = distance;
      result = [first, second];
    }
  }));
  return result;
}

function bearingDegrees(first, second) {
  const lat1 = first[1] * Math.PI / 180;
  const lat2 = second[1] * Math.PI / 180;
  const deltaLon = (second[0] - first[0]) * Math.PI / 180;
  return (Math.atan2(Math.sin(deltaLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)) * 180 / Math.PI + 360) % 360;
}

function angularDifference(first, second) {
  return Math.abs(((first - second + 540) % 360) - 180);
}

function distanceMeters(first, second) {
  const point = projectToLocalMeters(second, first);
  return Math.hypot(point.east, point.north);
}

function midpoint(first, second) {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
}

function number(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extentCenter(coordinates) {
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  return [(Math.min(...longitudes) + Math.max(...longitudes)) / 2, (Math.min(...latitudes) + Math.max(...latitudes)) / 2];
}

function flattenGeometryCoordinates(value) {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return [value];
  return value.flatMap(flattenGeometryCoordinates);
}

function interpolate(first, second, ratio) {
  return first + (second - first) * ratio;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
