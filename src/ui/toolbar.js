const tools = [
  { label: 'Select', icon: 'mouse-pointer-2', active: true },
  { label: 'Measure', icon: 'ruler', action: 'measure-toggle' },
  { label: 'Draw Building', icon: 'pencil', action: 'draw-building' },
  { label: 'Building Check', icon: 'building-2', action: 'building-check' },
  { label: 'Identify', icon: 'info', action: 'identify-toggle' },
  { label: 'Tour', icon: 'route', action: 'presentation-tour' },
  { label: 'Flight Path', icon: 'navigation', action: 'flight-path-toggle' },
  { label: 'Night Mode', icon: 'moon', action: 'night-mode-toggle' },
  { label: 'Story Mode', icon: 'play', action: 'safety-story' },
  { label: 'Zoom In', icon: 'zoom-in', disabled: true },
  { label: 'Zoom Out', icon: 'zoom-out', disabled: true },
  { label: 'Full Extent', icon: 'maximize', disabled: true },
  { label: 'Zoom To Layer', icon: 'layers', disabled: true },
  { label: 'Export SHP', icon: 'file-archive', action: 'export-building', disabled: true },
  { label: 'Edit', icon: 'square-pen', disabled: true },
  { label: 'More', icon: 'ellipsis', disabled: true },
];

export function toolbar() {
  const toolButtons = tools
    .map((tool) => `
      <button
        class="tool-button ${tool.active ? 'is-active' : ''}"
        type="button"
        aria-label="${tool.label}"
        title="${tool.label}"
        ${tool.action ? `data-${tool.action}` : ''}
        ${tool.disabled ? 'disabled' : ''}
      >
        <i data-lucide="${tool.icon}"></i>
        <span>${tool.label}</span>
      </button>
    `)
    .join('');

  return `
    <header class="top-toolbar">
      <button class="icon-button" type="button" aria-label="Open menu" title="Menu">
        <i data-lucide="menu"></i>
      </button>

      <div class="brand" aria-label="Airport GIS">
        <span class="brand-mark"><i data-lucide="plane"></i></span>
        <span class="brand-text">Airport GIS</span>
      </div>

      <label class="airport-picker">
        <span class="visually-hidden">Airport</span>
        <select aria-label="Airport selector">
          <option>Zəngilan Beynəlxalq Hava Limanı</option>
        </select>
      </label>

      <nav class="tool-group" aria-label="Map tools">
        <div class="view-toggle" aria-label="View mode">
          <button class="is-active" type="button" data-view-mode="2d" aria-pressed="true">2D</button>
          <button type="button" data-view-mode="3d" aria-pressed="false">3D</button>
        </div>
        ${toolButtons}
      </nav>

      <div class="toolbar-actions">
        <button class="primary-button compact" type="button" data-export-pdf title="Export current layout as PDF">
          <i data-lucide="file-down"></i>
          <span>Export PDF</span>
        </button>
        <button class="user-button" type="button" aria-label="User profile" title="User">
          <i data-lucide="user"></i>
        </button>
      </div>
    </header>
    <section class="measure-panel" data-measure-panel hidden aria-label="Measure length">
      <header class="measure-panel-header">
        <div>
          <span class="measure-panel-kicker">MEASUREMENT</span>
          <strong>Measure Length</strong>
        </div>
        <button class="icon-button" type="button" data-measure-close aria-label="Close measurement panel" title="Close">
          <i data-lucide="x"></i>
        </button>
      </header>
      <div class="measure-panel-body">
        <label class="field">
          <span>Result unit</span>
          <select data-measure-unit aria-label="Measurement unit">
            <option value="m">Meters (m)</option>
            <option value="km">Kilometers (km)</option>
            <option value="cm">Centimeters (cm)</option>
          </select>
        </label>
        <div class="measure-snap-status" data-measure-snap-status>
          <i data-lucide="magnet"></i>
          <span>Snap: endpoint, midpoint, vertex and edge</span>
        </div>
        <p>Click to add points. Double-click to finish the line.</p>
      </div>
      <footer class="measure-panel-actions">
        <button class="primary-button" type="button" data-measure-new>
          <i data-lucide="plus"></i><span>New measurement</span>
        </button>
        <button class="secondary-button" type="button" data-measure-clear>
          <i data-lucide="trash-2"></i><span>Clear</span>
        </button>
      </footer>
    </section>
    <section class="building-check-modal" data-building-check-modal hidden aria-label="Building OLS check">
      <header class="building-check-header">
        <div><span>OLS ANALYSIS</span><strong>Building Surface Check</strong></div>
        <button class="icon-button" type="button" data-building-check-close aria-label="Close building check"><i data-lucide="x"></i></button>
      </header>
      <form class="building-check-form" data-building-check-form>
        <p>Choose coordinate input or upload a ZIP containing a polygon Shapefile. Coordinates must be WGS84 (EPSG:4326).</p>
        <div class="building-input-tabs" role="tablist" aria-label="Building source">
          <button class="is-active" type="button" data-building-source="coordinates">Coordinates</button>
          <button type="button" data-building-source="shapefile">ZIP Shapefile</button>
        </div>
        <div class="building-coordinate-grid" data-building-coordinate-input>
          ${[1, 2, 3, 4].map((index) => `
            <fieldset>
              <legend>Point ${index}</legend>
              <label><span>Longitude</span><input type="number" step="any" data-building-lon="${index}" placeholder="46.740000" /></label>
              <label><span>Latitude</span><input type="number" step="any" data-building-lat="${index}" placeholder="39.110000" /></label>
            </fieldset>`).join('')}
        </div>
        <label class="building-file-input" data-building-file-input hidden>
          <span>Shapefile ZIP</span>
          <input type="file" accept=".zip,application/zip" data-building-zip />
          <small>ZIP must contain at least .shp, .shx and .dbf files. Polygon/MultiPolygon is supported.</small>
        </label>
        <label class="field"><span>Building height (m)</span><input type="number" min="0.01" step="0.01" required data-building-height placeholder="12.00" /></label>
        <div class="building-check-result" data-building-check-result hidden></div>
        <footer>
          <button class="primary-button" type="submit"><i data-lucide="shield-check"></i><span>Check surfaces</span></button>
          <button class="secondary-button" type="button" data-building-check-clear><i data-lucide="eraser"></i><span>Clear</span></button>
        </footer>
      </form>
    </section>
  `;
}
