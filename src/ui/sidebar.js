import { operationalAirportLayers } from '../config/airportLayers.js';

export function sidebar() {
  return `
    <aside class="left-sidebar panel" aria-label="Airport navigation">
      <button class="panel-pin-button" type="button" data-pin-panel="left" aria-label="Unpin left panel" title="Unpin panel">
        <i data-lucide="pin"></i>
      </button>
      <div class="tabs" role="tablist" aria-label="Sidebar sections">
        <button class="tab-button is-active" type="button" role="tab" aria-selected="true" data-tab-target="airports">
          Airports
        </button>
        <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab-target="layers">
          Layers
        </button>
      </div>

      <div class="sidebar-search">
        <i data-lucide="search"></i>
        <input type="search" placeholder="Search" aria-label="Search airports and layers" />
      </div>

      <section class="tab-panel" role="tabpanel" data-tab-panel="airports">
        <div class="tree">
          <div class="tree-node is-expanded">
            <button class="tree-parent" type="button" data-tree-toggle aria-expanded="true">
              <i class="tree-chevron" data-lucide="chevron-right"></i>
              <span class="node-icon"><i data-lucide="plane-takeoff"></i></span>
              <span>Zəngilan International Airport</span>
            </button>
            <div class="tree-children">
              <div data-airport-layer-list>${createLayerTreeMarkup()}</div>
            </div>
          </div>
        </div>
        <section class="legend-panel" aria-label="Map legend">
          <div class="legend-title">
            <i data-lucide="list-tree"></i>
            <span>Legend</span>
          </div>
          <div class="legend-list" data-legend-list>
            <div class="legend-row muted-tree-row">Loading legend</div>
          </div>
        </section>
      </section>

      <section class="tab-panel" role="tabpanel" data-tab-panel="layers" hidden>
        <div class="tree" data-layer-tab-list>
          <div data-airport-layer-list>${createLayerTreeMarkup()}</div>
        </div>
        ${createBasemapMarkup()}
      </section>
    </aside>
  `;
}

function createBasemapMarkup() {
  return `
    <section class="basemap-section" aria-labelledby="basemap-title">
      <div class="basemap-heading" id="basemap-title">
        <span class="node-icon"><i data-lucide="map"></i></span>
        <span>Basemap</span>
      </div>
      <div class="basemap-options" role="radiogroup" aria-label="Select basemap">
        <label class="basemap-option">
          <input type="radio" name="basemap" value="osm" data-basemap-toggle checked />
          <span class="basemap-preview basemap-preview-osm" aria-hidden="true"><i data-lucide="map"></i></span>
          <span class="basemap-copy"><strong>OpenStreetMap</strong><small>Street map</small></span>
          <span class="basemap-check"><i data-lucide="check"></i></span>
        </label>
        <label class="basemap-option">
          <input type="radio" name="basemap" value="google-satellite" data-basemap-toggle />
          <span class="basemap-preview basemap-preview-satellite" aria-hidden="true"><i data-lucide="satellite"></i></span>
          <span class="basemap-copy"><strong>Google Satellite</strong><small>Satellite imagery</small></span>
          <span class="basemap-check"><i data-lucide="check"></i></span>
        </label>
      </div>
    </section>`;
}

export function renderAirportLayerControls(root, layerManager) {
  renderLegend(root, layerManager);
}

function renderLegend(root, layerManager) {
  const legendItems = layerManager.getLayerIds().filter((layerId) => layerManager.getLayer(layerId).get('showInLegend') !== false).map((layerId) => {
    const layer = layerManager.getLayer(layerId);
    const color = layer.get('legendColor') ?? '#98a2b3';

    return `
      <div class="legend-row">
        <span class="legend-swatch" style="--legend-color: ${color}"></span>
        <span>${layer.get('title')}</span>
      </div>
    `;
  });

  root.querySelectorAll('[data-legend-list]').forEach((container) => {
    container.innerHTML = legendItems.join('');
  });
}

function createLayerTreeMarkup() {
  const baseLayers = operationalAirportLayers.filter((item) => item.category !== 'ols');
  const olsLayers = operationalAirportLayers.filter((item) => item.category === 'ols');
  const row = (item) => `
    <label class="tree-child layer-control">
      <input type="checkbox" ${item.visible ? 'checked' : ''} data-layer-toggle="${item.id}" />
      <span class="node-icon"><i data-lucide="${item.category === 'runway' ? 'route' : 'layers'}"></i></span>
      <span>${item.title}</span>
      <button class="layer-zoom-button" type="button" data-layer-zoom="${item.id}" aria-label="Zoom to ${item.title}" title="Zoom to layer">
        <i data-lucide="scan-search"></i>
      </button>
    </label>`;

  return `
    ${baseLayers.map(row).join('')}
    <div class="tree-node tree-node-nested is-expanded">
      <button class="tree-parent tree-parent-compact" type="button" data-tree-toggle aria-expanded="true">
        <i class="tree-chevron" data-lucide="chevron-right"></i>
        <span class="node-icon"><i data-lucide="cone"></i></span>
        <span>Obstacle Limitation Surfaces</span>
      </button>
      <div class="tree-children">${olsLayers.map(row).join('')}</div>
    </div>`;
}
