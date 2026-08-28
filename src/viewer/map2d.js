import Map from 'ol/Map.js';
import View from 'ol/View.js';
import Overlay from 'ol/Overlay.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import OSM from 'ol/source/OSM.js';
import XYZ from 'ol/source/XYZ.js';
import Feature from 'ol/Feature.js';
import Polygon from 'ol/geom/Polygon.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { LayerManager } from '../layers/layerManager.js';
import { createLengthMeasureTool } from './measure2d.js';
import { createBuildingDrawTool } from './buildingDraw2d.js';

const selectionStyle = new Style({
  fill: new Fill({ color: 'rgba(255, 221, 0, 0.26)' }),
  stroke: new Stroke({ color: '#facc15', width: 3 }),
});

export async function initializeMap2D({
  target = 'map',
  onLayersLoaded,
  onFeatureSelect,
  onLoadError,
  onStatusChange,
  onBuildingSelectionChange,
} = {}) {
  const osmBasemap = new TileLayer({
    source: new OSM(),
    visible: true,
    properties: {
      id: 'osm',
      title: 'OpenStreetMap',
      isBasemap: true,
    },
  });
  const googleBasemap = new TileLayer({
    source: new XYZ({
      url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      crossOrigin: 'anonymous',
      attributions: 'Imagery © Google',
      maxZoom: 22,
    }),
    visible: false,
    properties: {
      id: 'google-satellite',
      title: 'Google Satellite',
      isBasemap: true,
    },
  });
  const map = new Map({
    target,
    layers: [osmBasemap, googleBasemap],
    view: new View({
      projection: 'EPSG:3857',
      center: [0, 0],
      zoom: 2,
    }),
  });

  const popup = createPopupOverlay();
  map.addOverlay(popup.overlay);

  const layerManager = new LayerManager(map);
  const measureTool = createLengthMeasureTool(map);
  const buildingDrawTool = createBuildingDrawTool(map, onBuildingSelectionChange);
  const buildingSource = new VectorSource();
  const buildingLayer = new VectorLayer({ source: buildingSource, zIndex: 1100, properties: { id: 'building-check' } });
  map.addLayer(buildingLayer);
  let selectedFeature = null;
  let identifyActive = false;

  try {
    await layerManager.loadAirportLayers();

    measureTool.rebuildSnapIndex(layerManager);
    layerManager.zoomToLoadedData();
    onLayersLoaded?.(layerManager);
  } catch (error) {
    onLoadError?.(error);
  }

  map.on('singleclick', (event) => {
    let selectedLayer = null;
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate, layer) => {
      selectedLayer = layer;
      return candidate;
    });

    if (selectedFeature) {
      selectedFeature.setStyle(undefined);
    }

    selectedFeature = feature ?? null;

    if (!feature) {
      popup.overlay.setPosition(undefined);
      return;
    }

    feature.setStyle(selectionStyle);
    if (identifyActive) {
      popup.content.innerHTML = createPopupContent(feature);
      popup.overlay.setPosition(event.coordinate);
    } else {
      popup.overlay.setPosition(undefined);
    }
    onFeatureSelect?.(feature, selectedLayer);
  });

  map.on('pointermove', (event) => {
    if (event.dragging) {
      return;
    }

    const coordinate = event.coordinate;
    const [longitude, latitude] = toLonLat(coordinate);

    onStatusChange?.({
      x: coordinate[0].toFixed(2),
      y: coordinate[1].toFixed(2),
      lon: longitude.toFixed(6),
      lat: latitude.toFixed(6),
    });
  });

  map.getView().on('change:resolution', () => {
    onStatusChange?.({ scale: getApproximateScale(map) });
  });

  onStatusChange?.({ projection: 'WGS84', scale: getApproximateScale(map), mode: '2D' });

  return {
    map,
    layerManager,
    measureTool,
    buildingDrawTool,
    setBasemap(basemapId) {
      const useGoogle = basemapId === 'google-satellite';
      osmBasemap.setVisible(!useGoogle);
      googleBasemap.setVisible(useGoogle);
    },
    setIdentifyActive(isActive) {
      identifyActive = Boolean(isActive);
      if (!identifyActive) popup.overlay.setPosition(undefined);
      map.getTargetElement()?.classList.toggle('is-identifying', identifyActive);
    },
    showBuildingFootprint(result) {
      buildingSource.clear();
      const feature = new Feature(new Polygon([result.coordinates.map((coordinate) => fromLonLat(coordinate))]));
      feature.setProperties({ BİNA_HÜNDÜRLÜYÜ_M: result.heightMeters, STATUS: result.violation ? 'OLS POZUNTUSU' : 'TƏHLÜKƏSİZ' });
      feature.setStyle(new Style({
        fill: new Fill({ color: result.violation ? 'rgba(59, 130, 246, 0.22)' : 'rgba(34, 197, 94, 0.30)' }),
        stroke: new Stroke({ color: result.violation ? '#2563eb' : '#16a34a', width: 3 }),
      }));
      buildingSource.addFeature(feature);
      result.conflictPolygons.forEach((conflict) => {
        const conflictFeature = new Feature(new Polygon(conflict.coordinates.map((ring) => ring.map((coordinate) => fromLonLat(coordinate)))));
        conflictFeature.setProperties({ SƏTH: conflict.layerTitle, STATUS: 'POZUNTU' });
        conflictFeature.setStyle(new Style({
          fill: new Fill({ color: 'rgba(239, 68, 68, 0.58)' }),
          stroke: new Stroke({ color: '#facc15', width: 2.5 }),
        }));
        buildingSource.addFeature(conflictFeature);
      });
      map.getView().fit(feature.getGeometry().getExtent(), { padding: [100, 100, 100, 100], duration: 500, maxZoom: 19 });
    },
    clearBuildingFootprint() {
      buildingSource.clear();
    },
  };
}

function getApproximateScale(map) {
  const resolution = map.getView().getResolution();

  if (!resolution) {
    return '1:--';
  }

  return `1:${Math.round(resolution * 3779.52).toLocaleString('en-US')}`;
}

function createPopupOverlay() {
  const container = document.createElement('div');
  container.className = 'map-popup';

  const content = document.createElement('div');
  content.className = 'map-popup-content';
  container.append(content);

  const overlay = new Overlay({
    element: container,
    positioning: 'bottom-left',
    offset: [12, -12],
    stopEvent: true,
  });

  content.addEventListener('click', (event) => {
    if (event.target.closest('[data-popup-close]')) {
      overlay.setPosition(undefined);
    }
  });

  return { overlay, content };
}

function createPopupContent(feature) {
  const properties = getDisplayProperties(feature);
  const header = createPopupHeader('Feature Attributes');

  if (properties.length === 0) {
    return `${header}<div class="popup-empty">No attributes</div>`;
  }

  const rows = properties
    .map(([key, value]) => `
      <div class="popup-row">
        <span>${escapeHtml(key)}</span>
        <strong>${escapeHtml(formatValue(value))}</strong>
      </div>
    `)
    .join('');

  return `${header}${rows}`;
}

function createPopupHeader(title) {
  return `
    <div class="popup-header">
      <span class="popup-heading">
        <span class="popup-eyebrow">Identify Result</span>
        <span class="popup-title">${escapeHtml(title)}</span>
      </span>
      <button class="popup-close" type="button" data-popup-close aria-label="Close popup" title="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18 6 6 18M6 6l12 12"></path>
        </svg>
      </button>
    </div>`;
}

function getDisplayProperties(feature) {
  return Object.entries(feature.getProperties()).filter(([key]) => key !== 'geometry');
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };

    return entities[character];
  });
}
