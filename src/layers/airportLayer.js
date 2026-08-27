import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Fill, Stroke, Style } from 'ol/style.js';

export function createAirportVectorLayer(config, features) {
  return new VectorLayer({
    source: new VectorSource({ features }),
    style: new Style({
      fill: new Fill({ color: config.style2D.fill }),
      stroke: new Stroke({ color: config.style2D.stroke, width: config.style2D.width }),
    }),
    visible: config.visible,
    zIndex: config.zIndex,
    properties: {
      id: config.id,
      title: config.title,
      type: config.category,
      legendColor: config.style2D.stroke,
      showInLegend: config.showInLegend,
    },
  });
}
