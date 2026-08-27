import GeoJSON from 'ol/format/GeoJSON.js';
import { createAirportVectorLayer } from './airportLayer.js';
import { setLayerVisible } from './visibility.js';
import { loadGeoJson } from '../data/loader.js';
import { airportLayers } from '../config/airportLayers.js';

const dataProjection = 'EPSG:4326';
const featureProjection = 'EPSG:3857';

export class LayerManager {
  #map;
  #format;
  #layers;

  constructor(map) {
    this.#map = map;
    this.#format = new GeoJSON();
    this.#layers = new Map();
  }

  async loadAirportLayers() {
    return Promise.all(airportLayers.map(async (config) => {
      const features = await this.#readFeatures(config.path);
      const layer = createAirportVectorLayer(config, features);
      this.#registerLayer(config.id, layer);
      return layer;
    }));
  }

  setVisible(layerId, visible) {
    setLayerVisible(this.getLayer(layerId), visible);
  }

  zoomToLayer(layerId) {
    const layer = this.getLayer(layerId);
    const source = layer?.getSource();

    if (source && !source.isEmpty()) {
      this.#fitExtent(source.getExtent());
    }
  }

  getLayer(layerId) {
    return this.#layers.get(layerId);
  }

  getLayerIds() {
    return [...this.#layers.keys()];
  }

  getTotalExtent() {
    return this.getLayerIds().reduce((extent, layerId) => {
      const source = this.getLayer(layerId)?.getSource();

      if (!source || source.isEmpty()) {
        return extent;
      }

      const sourceExtent = source.getExtent();
      if (!extent) {
        return [...sourceExtent];
      }

      extent[0] = Math.min(extent[0], sourceExtent[0]);
      extent[1] = Math.min(extent[1], sourceExtent[1]);
      extent[2] = Math.max(extent[2], sourceExtent[2]);
      extent[3] = Math.max(extent[3], sourceExtent[3]);
      return extent;
    }, null);
  }

  zoomToLoadedData() {
    const extent = this.getTotalExtent();

    if (extent) {
      this.#fitExtent(extent);
    }
  }

  #registerLayer(layerId, layer) {
    this.#layers.set(layerId, layer);
    this.#map.addLayer(layer);
  }

  async #readFeatures(url) {
    const geoJson = await loadGeoJson(url);

    return this.#format.readFeatures(geoJson, {
      dataProjection,
      featureProjection,
    });
  }

  #fitExtent(extent) {
    this.#map.getView().fit(extent, {
      padding: [44, 44, 44, 44],
      duration: 450,
      maxZoom: 18,
    });
  }
}
