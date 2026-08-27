export function statusbar() {
  return `
    <footer class="status-bar" aria-label="Map status">
      <div>
        <span class="status-label">Projection</span>
        <strong data-status-projection>WGS84</strong>
      </div>
      <div>
        <span class="status-label">Longitude</span>
        <strong data-status-lon>--</strong>
      </div>
      <div>
        <span class="status-label">Latitude</span>
        <strong data-status-lat>--</strong>
      </div>
      <div>
        <span class="status-label">Scale</span>
        <strong data-status-scale>1:--</strong>
      </div>
      <div>
        <span class="status-label">Viewer Mode</span>
        <strong data-status-mode>2D</strong>
      </div>
    </footer>
  `;
}
