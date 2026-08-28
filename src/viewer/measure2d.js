import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Draw from 'ol/interaction/Draw.js';
import Snap from 'ol/interaction/Snap.js';
import Overlay from 'ol/Overlay.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { toLonLat } from 'ol/proj.js';
import { Fill, Circle as CircleStyle, Stroke, Style } from 'ol/style.js';
import { unByKey } from 'ol/Observable.js';

const lineStyle = new Style({
  stroke: new Stroke({ color: '#facc15', width: 3, lineDash: [10, 7] }),
  image: new CircleStyle({ radius: 5, fill: new Fill({ color: '#facc15' }), stroke: new Stroke({ color: '#ffffff', width: 2 }) }),
});

const WGS84_SEMI_MAJOR_AXIS_M = 6378137;
const WGS84_FLATTENING = 1 / 298.257223563;
const WGS84_SEMI_MINOR_AXIS_M = WGS84_SEMI_MAJOR_AXIS_M * (1 - WGS84_FLATTENING);

export function createLengthMeasureTool(map) {
  const measurementSource = new VectorSource();
  const snapSource = new VectorSource({ wrapX: false });
  const measurementLayer = new VectorLayer({ source: measurementSource, style: lineStyle, zIndex: 1000, properties: { id: 'measurements' } });
  const draw = new Draw({ source: measurementSource, type: 'LineString', style: lineStyle });
  const snap = new Snap({ source: snapSource, pixelTolerance: 16, vertex: true, edge: true, intersection: true });
  const snapIndicator = createSnapIndicator(map);
  const resultOverlays = [];
  let active = false;
  let unit = 'm';
  let liveOverlay = null;
  let geometryListener = null;

  map.addLayer(measurementLayer);
  draw.setActive(false);
  snap.setActive(false);
  map.addInteraction(draw);
  map.addInteraction(snap);

  snap.on('snap', (event) => {
    const snapType = event.feature?.get?.('snapType') ?? inferSnapType(event);
    snapIndicator.label.textContent = snapType;
    snapIndicator.element.dataset.snapType = snapType.toLowerCase();
    snapIndicator.overlay.setPosition(event.vertex);
  });
  snap.on('unsnap', () => snapIndicator.overlay.setPosition(undefined));

  draw.on('drawstart', (event) => {
    liveOverlay = createMeasureOverlay(map, 'measurement-tooltip is-live');
    geometryListener = event.feature.getGeometry().on('change', (geometryEvent) => {
      const geometry = geometryEvent.target;
      liveOverlay.meters = getWgs84GeodesicLength(geometry);
      liveOverlay.element.innerHTML = formatLength(liveOverlay.meters, unit);
      liveOverlay.overlay.setPosition(geometry.getLastCoordinate());
    });
  });

  draw.on('drawend', () => {
    if (geometryListener) unByKey(geometryListener);
    if (liveOverlay) {
      liveOverlay.element.classList.remove('is-live');
      liveOverlay.element.classList.add('is-complete');
      resultOverlays.push(liveOverlay);
      liveOverlay = null;
    }
  });

  return {
    setActive(nextActive) {
      active = Boolean(nextActive);
      draw.setActive(active);
      snap.setActive(active);
      if (!active) snapIndicator.overlay.setPosition(undefined);
      map.getTargetElement()?.classList.toggle('is-measuring', active);
      return active;
    },
    isActive: () => active,
    setUnit(nextUnit) {
      unit = ['cm', 'm', 'km'].includes(nextUnit) ? nextUnit : 'm';
      resultOverlays.forEach((item) => { item.element.innerHTML = formatLength(item.meters, unit); });
      if (liveOverlay) liveOverlay.element.innerHTML = formatLength(liveOverlay.meters, unit);
    },
    rebuildSnapIndex(layerManager) {
      snapSource.clear();
      layerManager.getLayerIds().forEach((layerId) => {
        layerManager.getLayer(layerId)?.getSource?.()?.getFeatures().forEach((feature) => addFeatureToSnapIndex(snapSource, feature, layerId));
      });
    },
    clear() {
      measurementSource.clear();
      resultOverlays.splice(0).forEach((item) => map.removeOverlay(item.overlay));
      if (liveOverlay) {
        map.removeOverlay(liveOverlay.overlay);
        liveOverlay = null;
      }
    },
  };
}

function addFeatureToSnapIndex(source, feature, layerId) {
  const geometry = feature.getGeometry();
  if (!geometry) return;
  const clone = feature.clone();
  clone.set('sourceLayerId', layerId);
  source.addFeature(clone);

  getCoordinateSequences(geometry).forEach(({ coordinates, closed }) => {
    const points = closed ? coordinates.slice(0, -1) : coordinates;
    points.forEach((coordinate, index) => addSnapPoint(
      source,
      coordinate,
      closed || index === 0 || index === points.length - 1 ? 'Endpoint' : 'Vertex',
      layerId,
    ));
    const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
    for (let index = 0; index < segmentCount; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      addSnapPoint(source, [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2], 'Midpoint', layerId);
    }
  });
}

function addSnapPoint(source, coordinate, snapType, layerId) {
  const point = new Feature(new Point(coordinate));
  point.setProperties({ snapType, sourceLayerId: layerId });
  source.addFeature(point);
}

function getCoordinateSequences(geometry) {
  const type = geometry.getType();
  const coordinates = geometry.getCoordinates();
  if (type === 'LineString') return [{ coordinates, closed: false }];
  if (type === 'MultiLineString') return coordinates.map((line) => ({ coordinates: line, closed: false }));
  if (type === 'Polygon') return coordinates.map((ring) => ({ coordinates: ring, closed: true }));
  if (type === 'MultiPolygon') return coordinates.flatMap((polygon) => polygon.map((ring) => ({ coordinates: ring, closed: true })));
  return [];
}

function inferSnapType(event) {
  if (!event.segment || !event.vertex) return 'Vertex';
  const [first, second] = event.segment;
  const midpoint = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
  return Math.hypot(midpoint[0] - event.vertex[0], midpoint[1] - event.vertex[1]) < 0.001 ? 'Midpoint' : 'Edge';
}

function createSnapIndicator(map) {
  const element = document.createElement('div');
  element.className = 'snap-indicator';
  const marker = document.createElement('span');
  const label = document.createElement('strong');
  element.append(marker, label);
  const overlay = new Overlay({ element, positioning: 'center-center', stopEvent: false });
  map.addOverlay(overlay);
  return { element, label, overlay };
}

function createMeasureOverlay(map, className) {
  const element = document.createElement('div');
  element.className = className;
  const overlay = new Overlay({ element, offset: [0, -14], positioning: 'bottom-center', stopEvent: false });
  map.addOverlay(overlay);
  return { element, overlay, meters: 0 };
}

export function getWgs84GeodesicLength(geometry) {
  const coordinates = geometry?.getCoordinates?.() ?? [];
  let totalMeters = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const first = toLonLat(coordinates[index - 1], geometry.getProjection?.() ?? 'EPSG:3857');
    const second = toLonLat(coordinates[index], geometry.getProjection?.() ?? 'EPSG:3857');
    totalMeters += vincentyDistance(first, second);
  }

  return totalMeters;
}

function vincentyDistance([longitude1, latitude1], [longitude2, latitude2]) {
  if (longitude1 === longitude2 && latitude1 === latitude2) return 0;

  const toRadians = Math.PI / 180;
  const reducedLatitude1 = Math.atan((1 - WGS84_FLATTENING) * Math.tan(latitude1 * toRadians));
  const reducedLatitude2 = Math.atan((1 - WGS84_FLATTENING) * Math.tan(latitude2 * toRadians));
  const longitudeDelta = (longitude2 - longitude1) * toRadians;
  let lambda = longitudeDelta;
  let previousLambda;
  let sinSigma;
  let cosSigma;
  let sigma;
  let sinAlpha;
  let cosSquaredAlpha;
  let cosTwoSigmaMidpoint;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    const firstTerm = Math.cos(reducedLatitude2) * sinLambda;
    const secondTerm = Math.cos(reducedLatitude1) * Math.sin(reducedLatitude2)
      - Math.sin(reducedLatitude1) * Math.cos(reducedLatitude2) * cosLambda;
    sinSigma = Math.hypot(firstTerm, secondTerm);
    if (sinSigma === 0) return 0;

    cosSigma = Math.sin(reducedLatitude1) * Math.sin(reducedLatitude2)
      + Math.cos(reducedLatitude1) * Math.cos(reducedLatitude2) * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = Math.cos(reducedLatitude1) * Math.cos(reducedLatitude2) * sinLambda / sinSigma;
    cosSquaredAlpha = 1 - sinAlpha ** 2;
    cosTwoSigmaMidpoint = cosSquaredAlpha === 0
      ? 0
      : cosSigma - 2 * Math.sin(reducedLatitude1) * Math.sin(reducedLatitude2) / cosSquaredAlpha;
    const coefficient = WGS84_FLATTENING / 16 * cosSquaredAlpha
      * (4 + WGS84_FLATTENING * (4 - 3 * cosSquaredAlpha));
    previousLambda = lambda;
    lambda = longitudeDelta + (1 - coefficient) * WGS84_FLATTENING * sinAlpha
      * (sigma + coefficient * sinSigma
        * (cosTwoSigmaMidpoint + coefficient * cosSigma * (-1 + 2 * cosTwoSigmaMidpoint ** 2)));

    if (Math.abs(lambda - previousLambda) <= 1e-12) break;
  }

  const squaredU = cosSquaredAlpha
    * (WGS84_SEMI_MAJOR_AXIS_M ** 2 - WGS84_SEMI_MINOR_AXIS_M ** 2)
    / WGS84_SEMI_MINOR_AXIS_M ** 2;
  const coefficientA = 1 + squaredU / 16384
    * (4096 + squaredU * (-768 + squaredU * (320 - 175 * squaredU)));
  const coefficientB = squaredU / 1024
    * (256 + squaredU * (-128 + squaredU * (74 - 47 * squaredU)));
  const sigmaCorrection = coefficientB * sinSigma
    * (cosTwoSigmaMidpoint + coefficientB / 4
      * (cosSigma * (-1 + 2 * cosTwoSigmaMidpoint ** 2)
        - coefficientB / 6 * cosTwoSigmaMidpoint * (-3 + 4 * sinSigma ** 2)
          * (-3 + 4 * cosTwoSigmaMidpoint ** 2)));

  return WGS84_SEMI_MINOR_AXIS_M * coefficientA * (sigma - sigmaCorrection);
}

function formatLength(meters, unit) {
  const values = {
    cm: { value: meters * 100, suffix: 'cm', digits: 1 },
    m: { value: meters, suffix: 'm', digits: 3 },
    km: { value: meters / 1000, suffix: 'km', digits: 6 },
  };
  const result = values[unit] ?? values.m;
  return `<strong>${result.value.toLocaleString('en-US', { maximumFractionDigits: result.digits, minimumFractionDigits: result.digits })} ${result.suffix}</strong>`;
}
