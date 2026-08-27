export function attributeTable() {
  return `
    <section class="attribute-panel" aria-label="Attribute table">
      <div class="attribute-header">
        <div>
          <h2>Attribute Table</h2>
        </div>

        <div class="attribute-controls">
          <button class="panel-pin-button inline-pin-button" type="button" data-pin-panel="attributes" aria-label="Unpin attribute table" title="Unpin panel">
            <i data-lucide="pin"></i>
          </button>
          <label>
            <span class="visually-hidden">Layer</span>
            <select aria-label="Layer" data-attribute-layer-select>
              <option>All Layers</option>
              <option>Runway</option>
              <option>OLS Surfaces</option>
            </select>
          </label>
          <label class="table-search">
            <i data-lucide="search"></i>
            <input type="search" placeholder="Search attributes" aria-label="Search attributes" />
          </label>
          <button class="secondary-button" type="button">
            <i data-lucide="download"></i>
            <span>Export</span>
          </button>
        </div>
      </div>

      <div class="table-wrap">
        <table data-attribute-table>
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr class="empty-row">
              <td colspan="2">Click a runway or OLS polygon to view attributes.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="table-footer">
        <label>
          <span>Rows Per Page</span>
          <select>
            <option>10</option>
            <option>25</option>
            <option>50</option>
          </select>
        </label>
        <div class="pagination" aria-label="Pagination">
          <button type="button" disabled><i data-lucide="chevron-left"></i></button>
          <span>Page 1 of 1</span>
          <button type="button" disabled><i data-lucide="chevron-right"></i></button>
        </div>
      </div>
    </section>
  `;
}

export function renderFeatureAttributes(root, feature, layerTitle = 'Selected Feature') {
  const table = root.querySelector('[data-attribute-table]');
  const select = root.querySelector('[data-attribute-layer-select]');
  const properties = Object.entries(feature.getProperties()).filter(([key]) => key !== 'geometry');

  if (select) {
    select.innerHTML = `<option>${escapeHtml(layerTitle)}</option>`;
  }

  if (properties.length === 0) {
    table.innerHTML = `
      <thead>
        <tr><th scope="col">Attribute</th><th scope="col">Value</th></tr>
      </thead>
      <tbody>
        <tr class="empty-row"><td colspan="2">No attributes found.</td></tr>
      </tbody>
    `;
    return;
  }

  const rows = properties
    .map(([, value]) => `<td>${escapeHtml(formatValue(value))}</td>`)
    .join('');
  const headerCells = properties
    .map(([key]) => `<th scope="col"><button type="button" data-sort-column="${escapeHtml(key)}">${escapeHtml(key)}</button></th>`)
    .join('');

  table.innerHTML = `
    <thead>
      <tr>${headerCells}</tr>
    </thead>
    <tbody>
      <tr class="selected-row">${rows}</tr>
    </tbody>
  `;
}

export function renderTableMessage(root, message) {
  const table = root.querySelector('[data-attribute-table]');

  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Attribute</th>
        <th scope="col">Value</th>
      </tr>
    </thead>
    <tbody>
      <tr class="empty-row"><td colspan="2">${escapeHtml(message)}</td></tr>
    </tbody>
  `;
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
