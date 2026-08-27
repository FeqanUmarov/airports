const layoutOptions = ['Title', 'North Arrow', 'Legend', 'Scale Bar', 'Coordinate Grid', 'Company Logo'];

export function rightPanel() {
  const checkboxes = layoutOptions
    .map((label) => `
      <label class="checkbox-row">
        <input type="checkbox" checked data-layout-option="${label}" />
        <span>${label}</span>
      </label>
    `)
    .join('');

  return `
    <aside class="right-sidebar panel" aria-label="Map layout settings">
      <div class="panel-header">
        <span>Map Layout</span>
        <button class="panel-pin-button" type="button" data-pin-panel="right" aria-label="Unpin right panel" title="Unpin panel">
          <i data-lucide="pin"></i>
        </button>
      </div>

      <div class="form-stack">
        <label class="field">
          <span>Paper Size</span>
          <select data-layout-paper>
            <option>A3</option>
            <option>A4</option>
            <option>Letter</option>
          </select>
        </label>

        <div class="field">
          <span>Orientation</span>
          <div class="segmented-control" aria-label="Page orientation">
            <button class="is-active" type="button" data-layout-orientation="landscape" aria-pressed="true">
              <i data-lucide="rectangle-horizontal"></i>
              <span>Landscape</span>
            </button>
            <button type="button" data-layout-orientation="portrait" aria-pressed="false">
              <i data-lucide="rectangle-vertical"></i>
              <span>Portrait</span>
            </button>
          </div>
        </div>

        <label class="field">
          <span>Scale</span>
          <select data-layout-scale>
            <option>1:25,000</option>
            <option>1:10,000</option>
            <option>1:5,000</option>
          </select>
        </label>

        <div class="checkbox-list" aria-label="Layout elements">
          ${checkboxes}
        </div>

        <div class="upload-placeholder">
          <i data-lucide="upload-cloud"></i>
          <span>Company Logo</span>
        </div>

        <details class="advanced-options">
          <summary>Advanced Options</summary>
          <div class="advanced-body">
            <label class="field">
              <span>Margins</span>
              <select data-layout-margins>
                <option>Standard 12 mm</option>
                <option>Narrow 8 mm</option>
                <option>Wide 18 mm</option>
              </select>
            </label>
            <label class="field">
              <span>Grid Interval</span>
              <input type="text" value="1 km" data-layout-grid-interval />
            </label>
          </div>
        </details>
      </div>

      <div class="panel-actions">
        <button class="primary-button large" type="button" data-export-pdf title="Generate PDF from the selected layout settings">
          <i data-lucide="file-down"></i>
          <span>Export as PDF</span>
        </button>
        <button class="secondary-button large" type="button" data-preview-pdf title="Preview the selected layout before exporting">
          <i data-lucide="eye"></i>
          <span>Preview Layout</span>
        </button>
      </div>
    </aside>
  `;
}
