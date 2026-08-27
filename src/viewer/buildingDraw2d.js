import Draw from 'ol/interaction/Draw.js';
import Select from 'ol/interaction/Select.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import shpwrite from '@mapbox/shp-write';

const buildingStyle = new Style({
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.22)' }),
  stroke: new Stroke({ color: '#2563eb', width: 2.5 }),
});

const selectedStyle = new Style({
  fill: new Fill({ color: 'rgba(245, 158, 11, 0.3)' }),
  stroke: new Stroke({ color: '#f59e0b', width: 4 }),
});

export function createBuildingDrawTool(map, onSelectionChange) {
  const source = new VectorSource({ wrapX: false });
  const layer = new VectorLayer({
    source,
    zIndex: 1050,
    style: buildingStyle,
    properties: { id: 'drawn-buildings', title: 'Drawn Buildings' },
  });
  const draw = new Draw({ source, type: 'Polygon' });
  const select = new Select({ layers: [layer], style: selectedStyle });
  let nextId = 1;

  map.addLayer(layer);
  map.addInteraction(draw);
  map.addInteraction(select);
  draw.setActive(false);

  draw.on('drawend', (event) => {
    event.feature.setProperties({ BUILDING_ID: nextId, CREATED_AT: new Date().toISOString() });
    nextId += 1;
    draw.setActive(false);
    map.getTargetElement()?.classList.remove('is-drawing-building');
    select.getFeatures().clear();
    select.getFeatures().push(event.feature);
    onSelectionChange?.(event.feature);
  });

  select.on('select', () => onSelectionChange?.(select.getFeatures().item(0) ?? null));

  return {
    startDrawing() {
      select.getFeatures().clear();
      draw.setActive(true);
      map.getTargetElement()?.classList.add('is-drawing-building');
    },
    stopDrawing() {
      draw.setActive(false);
      map.getTargetElement()?.classList.remove('is-drawing-building');
    },
    hasSelection() {
      return select.getFeatures().getLength() > 0;
    },
    async exportSelected() {
      const feature = select.getFeatures().item(0);
      if (!feature) throw new Error('Select a drawn building first.');
      const geoJson = new GeoJSON().writeFeatureObject(feature, {
        featureProjection: map.getView().getProjection(),
        dataProjection: 'EPSG:4326',
      });
      const blob = await shpwrite.zip({ type: 'FeatureCollection', features: [geoJson] }, {
        folder: 'building',
        filename: 'building',
        outputType: 'blob',
        compression: 'DEFLATE',
        types: { polygon: 'building' },
      });
      downloadBlob(blob, `building-${geoJson.properties.BUILDING_ID ?? 'selected'}.zip`);
    },
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
