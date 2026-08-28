import { createIcons, icons } from 'lucide';
import { toolbar } from './ui/toolbar.js';
import { renderAirportLayerControls, sidebar } from './ui/sidebar.js';
import { rightPanel } from './ui/rightPanel.js';
import { attributeTable, renderFeatureAttributes, renderTableMessage } from './ui/attributeTable.js';
import { initializeLayoutExport } from './ui/pdfExport.js';
import { statusbar } from './ui/statusbar.js';
import { setFlightSoundActive } from './audio/flightSound.js';
import { initializeMap2D } from './viewer/map2d.js';
import { checkBuildingFootprint } from './analysis/buildingCheck.js';
import { readBuildingFromZip } from './data/shapefile.js';
import {
  flyToAirport3D,
  initializeMap3D,
  setCesiumVisible,
  setIdentifyMode3D,
  setFlightPathExplanationVisible,
  setNightOperationsExplanationVisible,
  showBuildingCheck3D,
  clearBuildingCheck3D,
  startSafetyStory3D,
  startPresentationTour3D,
} from './viewer/map3d.js';

export async function initializeApp() {
  const app = document.querySelector('#app');
  const viewerState = {
    activeView: '2d',
    layerManager2D: null,
    entityManager3D: null,
    map2D: null,
    measureTool2D: null,
    buildingDrawTool2D: null,
    setIdentify2D: null,
    setBasemap2D: null,
    identifyActive: false,
    showBuildingFootprint: null,
    clearBuildingFootprint: null,
    lastBuildingCheck: null,
    viewer3D: null,
    is3DInitializing: false,
  };

  app.innerHTML = `
    <div class="shell">
      ${toolbar()}
      <main class="workspace" aria-label="Airport GIS workspace">
        ${sidebar()}
        <div class="resize-handle resize-handle-vertical left-resize-handle" data-resize-panel="left" aria-hidden="true"></div>
        <section class="map-stage" aria-label="Map viewport">
          <div class="map-container">
            <div id="map" class="viewer-surface"></div>
            <div id="cesium-map" class="viewer-surface" hidden></div>
          </div>
          <div class="resize-handle resize-handle-horizontal attribute-resize-handle" data-resize-panel="attributes" aria-hidden="true"></div>
          ${attributeTable()}
        </section>
        <div class="resize-handle resize-handle-vertical right-resize-handle" data-resize-panel="right" aria-hidden="true"></div>
        ${rightPanel()}
      </main>
      ${statusbar()}
    </div>
  `;

  renderIcons();

  initializeShellInteractions(app);
  initializeToolbarTools(app);
  initializeAttributeTableInteractions(app);
  initializeViewToggle(app, viewerState);
  initializePresentationTour(app, viewerState);
  initializeFlightPathDemo(app, viewerState);
  initializeNightOperations(app, viewerState);
  initializeSafetyStory(app, viewerState);
  initializeLayerZoom(app, viewerState);
  initializeMeasureTool(app, viewerState);
  initializeIdentifyTool(app, viewerState);
  initializeBuildingCheck(app, viewerState);
  initializeBuildingDrawing(app, viewerState);
  initializeMeasurePanelDragging(app);
  initializeLayoutExport(app);
  initializePanelResizing(app, viewerState);
  initializePanelPinning(app, viewerState);
  const map2DState = await initializeMap2D({
    onLayersLoaded: (layerManager) => {
      viewerState.layerManager2D = layerManager;
      renderAirportLayerControls(app, layerManager);
      renderIcons();
      initializeLayerControls(app, viewerState);
    },
    onFeatureSelect: (feature, layer) => {
      renderFeatureAttributes(app, feature, layer?.get('title') ?? 'Selected Feature');
    },
    onStatusChange: (status) => {
      updateStatus(app, status);
    },
    onBuildingSelectionChange: (feature) => {
      const exportButton = app.querySelector('[data-export-building]');
      if (exportButton) exportButton.disabled = !feature;
      app.querySelector('[data-draw-building]')?.classList.remove('is-active');
    },
    onLoadError: (error) => {
      renderTableMessage(app, error.message);
    },
  });

  viewerState.map2D = map2DState.map;
  viewerState.layerManager2D = map2DState.layerManager;
  viewerState.measureTool2D = map2DState.measureTool;
  viewerState.buildingDrawTool2D = map2DState.buildingDrawTool;
  viewerState.setIdentify2D = map2DState.setIdentifyActive;
  viewerState.setBasemap2D = map2DState.setBasemap;
  viewerState.showBuildingFootprint = map2DState.showBuildingFootprint;
  viewerState.clearBuildingFootprint = map2DState.clearBuildingFootprint;
  viewerState.setIdentify2D(viewerState.identifyActive);
}

function initializeShellInteractions(root) {
  const tabButtons = root.querySelectorAll('[data-tab-target]');
  const tabPanels = root.querySelectorAll('[data-tab-panel]');

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.tabTarget;

      tabButtons.forEach((item) => {
        item.classList.toggle('is-active', item === button);
        item.setAttribute('aria-selected', String(item === button));
      });

      tabPanels.forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== target;
      });
    });
  });

  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tree-toggle]');

    if (!button || !root.contains(button)) {
      return;
    }

    const treeItem = button.closest('.tree-node');
    const isExpanded = treeItem.classList.toggle('is-expanded');

    button.setAttribute('aria-expanded', String(isExpanded));
  });
}

function initializeToolbarTools(root) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('.tool-button:not(:disabled)');

    if (!button || button.matches('[data-presentation-tour], [data-flight-path-toggle], [data-night-mode-toggle], [data-safety-story], [data-measure-toggle], [data-identify-toggle], [data-building-check], [data-draw-building], [data-export-building]')) {
      return;
    }

    root.querySelectorAll('.tool-button').forEach((toolButton) => {
      toolButton.classList.toggle('is-active', toolButton === button);
    });
  });
}

function initializeIdentifyTool(root, viewerState) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-identify-toggle]');
    if (!button) return;

    viewerState.identifyActive = !viewerState.identifyActive;
    viewerState.setIdentify2D?.(viewerState.identifyActive);
    setIdentifyMode3D(viewerState.identifyActive);
    button.classList.toggle('is-active', viewerState.identifyActive);
    button.setAttribute('aria-pressed', String(viewerState.identifyActive));
    button.title = viewerState.identifyActive ? 'Identify is active — click a feature' : 'Identify feature';
  });
}

function initializeBuildingCheck(root, viewerState) {
  const modal = root.querySelector('[data-building-check-modal]');
  const form = root.querySelector('[data-building-check-form]');
  const resultBox = root.querySelector('[data-building-check-result]');
  let sourceMode = 'coordinates';

  root.addEventListener('click', (event) => {
    const sourceButton = event.target.closest('[data-building-source]');
    if (!sourceButton) return;
    sourceMode = sourceButton.dataset.buildingSource;
    root.querySelectorAll('[data-building-source]').forEach((button) => button.classList.toggle('is-active', button === sourceButton));
    root.querySelector('[data-building-coordinate-input]').hidden = sourceMode !== 'coordinates';
    root.querySelector('[data-building-file-input]').hidden = sourceMode !== 'shapefile';
  });

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-building-check]')) {
      if (viewerState.activeView !== '2d') switchTo2D(root, viewerState);
      modal.hidden = false;
      return;
    }
    if (event.target.closest('[data-building-check-close]')) {
      modal.hidden = true;
      return;
    }
    if (event.target.closest('[data-building-check-clear]')) {
      form.reset();
      resultBox.hidden = true;
      resultBox.innerHTML = '';
      viewerState.clearBuildingFootprint?.();
      viewerState.lastBuildingCheck = null;
      clearBuildingCheck3D();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    const heightMeters = Number(form.querySelector('[data-building-height]').value);
    let coordinates;
    try {
      coordinates = sourceMode === 'shapefile'
        ? await readBuildingFromZip(form.querySelector('[data-building-zip]').files[0])
        : [1, 2, 3, 4].map((index) => [
          Number(form.querySelector(`[data-building-lon="${index}"]`).value),
          Number(form.querySelector(`[data-building-lat="${index}"]`).value),
        ]);
    } catch (error) {
      resultBox.hidden = false;
      resultBox.className = 'building-check-result is-error';
      resultBox.textContent = error.message;
      return;
    }

    const invalidCoordinate = coordinates.some(([longitude, latitude]) => (
      !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90
    ));
    if (invalidCoordinate || !Number.isFinite(heightMeters) || heightMeters <= 0) {
      resultBox.hidden = false;
      resultBox.className = 'building-check-result is-error';
      resultBox.textContent = 'Dörd düzgün WGS84 koordinat cütü və sıfırdan böyük bina hündürlüyü daxil edin.';
      return;
    }

    submitButton.disabled = true;
    try {
      const result = await checkBuildingFootprint(coordinates, heightMeters);
      viewerState.lastBuildingCheck = result;
      viewerState.showBuildingFootprint?.(result);
      renderBuildingCheckResult(resultBox, result);
    } catch (error) {
      resultBox.hidden = false;
      resultBox.className = 'building-check-result is-error';
      resultBox.textContent = `Təhlil zamanı xəta baş verdi: ${error.message}`;
    } finally {
      submitButton.disabled = false;
    }
  });
}

function renderBuildingCheckResult(container, result) {
  container.hidden = false;
  container.className = `building-check-result ${result.violation ? 'is-violation' : 'is-clear'}`;
  const title = result.violation
    ? 'OLS səthi pozuntusu aşkarlandı'
    : (result.intersectsAnySurface ? 'Hündürlük pozuntusu yoxdur' : 'Bina heç bir OLS səthi ilə kəsişmir');
  const rows = result.surfaceReport.map((item) => `
    <tr>
      <td>${item.layerTitle}</td>
      <td>${item.overlapsFootprint ? `${item.maximumHeight.toFixed(2)} m` : '—'}</td>
      <td>${item.violation ? `${item.penetrationMeters.toFixed(2)} m` : '—'}</td>
      <td>${item.status}</td>
      <td>${item.message}</td>
    </tr>`).join('');
  container.innerHTML = `
    <strong>${title}</strong>
    <span>Bina hündürlüyü: ${result.heightMeters.toFixed(2)} m</span>
    ${result.violation ? `<span><strong>Maksimum OLS pozuntu dərinliyi: ${result.maximumPenetrationMeters.toFixed(2)} m</strong></span>` : ''}
    <span>Mavi/yaşıl rəng binanın tam konturunu, qırmızı-narıncı rəng isə yalnız OLS səthinin üzərində qalan pozuntu hissəsini göstərir. Hündürlüklər yerli yer səviyyəsinə nəzərən hesablanır.</span>
    ${rows ? `<div class="building-result-table"><table><thead><tr><th>Səth</th><th>Maksimum icazəli hündürlük</th><th>Pozuntu dərinliyi</th><th>Status</th><th>İzah</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
}

function initializeBuildingDrawing(root, viewerState) {
  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-draw-building]')) {
      if (viewerState.activeView !== '2d') switchTo2D(root, viewerState);
      viewerState.measureTool2D?.setActive(false);
      viewerState.buildingDrawTool2D?.startDrawing();
      const button = root.querySelector('[data-draw-building]');
      button?.classList.add('is-active');
      button.title = 'Click vertices on the map; click the first point to finish';
      return;
    }
    if (event.target.closest('[data-export-building]')) {
      try {
        await viewerState.buildingDrawTool2D?.exportSelected();
      } catch (error) {
        renderTableMessage(root, error.message);
      }
    }
  });
}

function initializeMeasureTool(root, viewerState) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-measure-toggle]');
    const closeButton = event.target.closest('[data-measure-close]');
    const newButton = event.target.closest('[data-measure-new]');
    const clearButton = event.target.closest('[data-measure-clear]');
    const panel = root.querySelector('[data-measure-panel]');

    if (button) {
      if (!viewerState.measureTool2D) return;
      if (viewerState.activeView !== '2d') switchTo2D(root, viewerState);
      panel.hidden = false;
      viewerState.measureTool2D.setActive(true);
      button.classList.add('is-active');
      button.setAttribute('aria-pressed', 'true');
      return;
    }

    if (closeButton) {
      panel.hidden = true;
      viewerState.measureTool2D?.setActive(false);
      const toolButton = root.querySelector('[data-measure-toggle]');
      toolButton?.classList.remove('is-active');
      toolButton?.setAttribute('aria-pressed', 'false');
      return;
    }

    if (newButton) {
      viewerState.measureTool2D?.setActive(true);
      return;
    }

    if (clearButton) viewerState.measureTool2D?.clear();
  });

  root.addEventListener('change', (event) => {
    const unitSelect = event.target.closest('[data-measure-unit]');
    if (unitSelect) viewerState.measureTool2D?.setUnit(unitSelect.value);
  });
}

function initializeMeasurePanelDragging(root) {
  initializeDraggablePanel(root.querySelector('[data-measure-panel]'), '.measure-panel-header');
  initializeDraggablePanel(root.querySelector('[data-building-check-modal]'), '.building-check-header');
}

function initializeDraggablePanel(panel, handleSelector) {
  const handle = panel?.querySelector(handleSelector);
  let dragState = null;

  if (!panel || !handle) return;

  handle.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input, select')) return;
    const bounds = panel.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    panel.style.left = `${bounds.left}px`;
    panel.style.top = `${bounds.top}px`;
    panel.style.transform = 'none';
    handle.setPointerCapture(event.pointerId);
    panel.classList.add('is-dragging');
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    panel.style.left = `${clamp(event.clientX - dragState.offsetX, 8, maxLeft)}px`;
    panel.style.top = `${clamp(event.clientY - dragState.offsetY, 8, maxTop)}px`;
  });

  const stopDragging = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState = null;
    panel.classList.remove('is-dragging');
  };

  handle.addEventListener('pointerup', stopDragging);
  handle.addEventListener('pointercancel', stopDragging);
}

function initializePresentationTour(root, viewerState) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-presentation-tour]');

    if (!button) {
      return;
    }

    button.disabled = true;
    button.classList.add('is-active', 'is-running');

    try {
      await ensureMap3D(root, viewerState);

      if (viewerState.activeView !== '3d') {
        switchTo3D(root, viewerState);
      }

      await startPresentationTour3D({
        onStart: () => {
          button.classList.add('is-running');
        },
        onStop: () => {
          button.classList.remove('is-running', 'is-active');
        },
      });
    } finally {
      button.disabled = false;
      button.classList.remove('is-running');
    }
  });
}

function initializeFlightPathDemo(root, viewerState) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-flight-path-toggle]');

    if (!button) {
      return;
    }

    button.disabled = true;
    setFlightSoundActive(true);

    try {
      await ensureMap3D(root, viewerState);

      if (viewerState.activeView !== '3d') {
        switchTo3D(root, viewerState);
      }

      const isVisible = await viewerState.entityManager3D?.toggleFlightPathDemo();

      setFlightSoundActive(Boolean(isVisible));

      button.classList.toggle('is-active', Boolean(isVisible));
      button.setAttribute('aria-pressed', String(Boolean(isVisible)));
      setFlightPathExplanationVisible(Boolean(isVisible));

      if (isVisible) {
        viewerState.entityManager3D?.zoomToLayer('flight-path');
      }
    } catch (error) {
      setFlightSoundActive(false);
      throw error;
    } finally {
      button.disabled = false;
    }
  });
}

function initializeNightOperations(root, viewerState) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-night-mode-toggle]');

    if (!button) {
      return;
    }

    button.disabled = true;

    try {
      await ensureMap3D(root, viewerState);

      if (viewerState.activeView !== '3d') {
        switchTo3D(root, viewerState);
      }

      const isVisible = await viewerState.entityManager3D?.toggleNightOperations();

      button.classList.toggle('is-active', Boolean(isVisible));
      button.setAttribute('aria-pressed', String(Boolean(isVisible)));
      setNightOperationsExplanationVisible(Boolean(isVisible));

      if (isVisible) {
        viewerState.entityManager3D?.zoomToLayer('night-ops');
      }
    } finally {
      button.disabled = false;
    }
  });
}

function initializeSafetyStory(root, viewerState) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-safety-story]');

    if (!button) {
      return;
    }

    button.disabled = true;
    button.classList.add('is-active', 'is-running');

    try {
      await ensureMap3D(root, viewerState);

      if (viewerState.activeView !== '3d') {
        switchTo3D(root, viewerState);
      }

      await startSafetyStory3D({
        onStateChange: (state) => {
          syncPresentationToolButtons(root, state);
        },
        onStop: () => {
          button.classList.remove('is-running', 'is-active');
        },
      });
    } finally {
      button.disabled = false;
      button.classList.remove('is-running');
    }
  });
}

function initializeAttributeTableInteractions(root) {
  root.addEventListener('click', (event) => {
    const sortButton = event.target.closest('[data-sort-column]');

    if (!sortButton) {
      return;
    }

    const table = sortButton.closest('table');
    const header = sortButton.closest('th');
    const columnIndex = [...header.parentElement.children].indexOf(header);
    const tbody = table.querySelector('tbody');
    const rows = [...tbody.querySelectorAll('tr')];
    const nextDirection = sortButton.dataset.sortDirection === 'asc' ? 'desc' : 'asc';

    rows
      .sort((firstRow, secondRow) => {
        const firstValue = firstRow.children[columnIndex]?.textContent.trim() ?? '';
        const secondValue = secondRow.children[columnIndex]?.textContent.trim() ?? '';
        return firstValue.localeCompare(secondValue, undefined, { numeric: true }) * (nextDirection === 'asc' ? 1 : -1);
      })
      .forEach((row) => tbody.append(row));

    table.querySelectorAll('[data-sort-column]').forEach((button) => {
      button.removeAttribute('data-sort-direction');
    });
    sortButton.dataset.sortDirection = nextDirection;
  });
}

function initializeLayerControls(root, viewerState) {
  if (root.dataset.layerControlsReady === 'true') {
    return;
  }

  root.dataset.layerControlsReady = 'true';

  root.addEventListener('change', (event) => {
    const basemapRadio = event.target.closest('[data-basemap-toggle]');

    if (basemapRadio) {
      viewerState.setBasemap2D?.(basemapRadio.value);
      return;
    }

    const checkbox = event.target.closest('[data-layer-toggle]');

    if (!checkbox) {
      return;
    }

    const layerId = checkbox.dataset.layerToggle;
    const isVisible = checkbox.checked;

    viewerState.layerManager2D?.setVisible(layerId, isVisible);
    viewerState.entityManager3D?.setVisible(layerId, isVisible);
    syncLayerCheckboxes(root, layerId, isVisible);
  });
}

function initializeLayerZoom(root, viewerState) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-layer-zoom]');

    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const layerId = button.dataset.layerZoom;

    if (viewerState.activeView === '3d') {
      viewerState.entityManager3D?.zoomToLayer(layerId);
      return;
    }

    viewerState.layerManager2D?.zoomToLayer(layerId);
  });
}

function initializePanelResizing(root, viewerState) {
  const workspace = root.querySelector('.workspace');
  const mapStage = root.querySelector('.map-stage');
  let resizeState = null;

  root.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-resize-panel]');

    if (!handle) {
      return;
    }

    if (isPanelUnpinned(root, handle.dataset.resizePanel)) {
      return;
    }

    event.preventDefault();
    handle.setPointerCapture(event.pointerId);

    resizeState = {
      panel: handle.dataset.resizePanel,
      startX: event.clientX,
      startY: event.clientY,
      leftWidth: getCurrentPanelSize(root, 'left'),
      rightWidth: getCurrentPanelSize(root, 'right'),
      attributeHeight: getCurrentPanelSize(root, 'attributes'),
      workspaceWidth: workspace.getBoundingClientRect().width,
      mapStageHeight: mapStage.getBoundingClientRect().height,
    };

    document.body.classList.add('is-resizing-panel');
  });

  root.addEventListener('pointermove', (event) => {
    if (!resizeState) {
      return;
    }

    const nextSize = getNextPanelSize(event, resizeState);
    applyPanelSize(workspace, mapStage, resizeState.panel, nextSize);
    refreshViewers(viewerState);
  });

  root.addEventListener('pointerup', () => {
    if (!resizeState) {
      return;
    }

    resizeState = null;
    document.body.classList.remove('is-resizing-panel');
    refreshViewers(viewerState);
  });
}

function initializePanelPinning(root, viewerState) {
  const workspace = root.querySelector('.workspace');
  const mapStage = root.querySelector('.map-stage');

  root.addEventListener('click', (event) => {
    const pinButton = event.target.closest('[data-pin-panel]');

    if (pinButton) {
      event.preventDefault();
      event.stopPropagation();
      togglePanelPin(root, viewerState, pinButton.dataset.pinPanel);
      return;
    }

    const collapsedPanel = event.target.closest('.is-panel-unpinned');

    if (collapsedPanel?.matches('.left-sidebar')) {
      pinPanel(root, viewerState, 'left');
    }

    if (collapsedPanel?.matches('.right-sidebar')) {
      pinPanel(root, viewerState, 'right');
    }

    if (collapsedPanel?.matches('.attribute-panel')) {
      pinPanel(root, viewerState, 'attributes');
    }
  });

  workspace.dataset.leftPinnedWidth = `${getCurrentPanelSize(root, 'left')}`;
  workspace.dataset.rightPinnedWidth = `${getCurrentPanelSize(root, 'right')}`;
  mapStage.dataset.attributePinnedHeight = `${getCurrentPanelSize(root, 'attributes')}`;
}

function togglePanelPin(root, viewerState, panel) {
  if (isPanelUnpinned(root, panel)) {
    pinPanel(root, viewerState, panel);
    return;
  }

  unpinPanel(root, viewerState, panel);
}

function unpinPanel(root, viewerState, panel) {
  const workspace = root.querySelector('.workspace');
  const mapStage = root.querySelector('.map-stage');

  if (panel === 'left') {
    workspace.dataset.leftPinnedWidth = `${getCurrentPanelSize(root, 'left')}`;
    workspace.style.setProperty('--left-panel-width', '44px');
    workspace.classList.add('is-left-unpinned');
    root.querySelector('.left-sidebar').classList.add('is-panel-unpinned');
  }

  if (panel === 'right') {
    workspace.dataset.rightPinnedWidth = `${getCurrentPanelSize(root, 'right')}`;
    workspace.style.setProperty('--right-panel-width', '44px');
    workspace.classList.add('is-right-unpinned');
    root.querySelector('.right-sidebar').classList.add('is-panel-unpinned');
  }

  if (panel === 'attributes') {
    mapStage.dataset.attributePinnedHeight = `${getCurrentPanelSize(root, 'attributes')}`;
    mapStage.style.setProperty('--attribute-panel-height', '42px');
    mapStage.classList.add('is-attributes-unpinned');
    root.querySelector('.attribute-panel').classList.add('is-panel-unpinned');
  }

  updatePinButtons(root, panel, false);
  refreshViewers(viewerState);
}

function pinPanel(root, viewerState, panel) {
  const workspace = root.querySelector('.workspace');
  const mapStage = root.querySelector('.map-stage');

  if (panel === 'left') {
    workspace.style.setProperty('--left-panel-width', `${workspace.dataset.leftPinnedWidth || 320}px`);
    workspace.classList.remove('is-left-unpinned');
    root.querySelector('.left-sidebar').classList.remove('is-panel-unpinned');
  }

  if (panel === 'right') {
    workspace.style.setProperty('--right-panel-width', `${workspace.dataset.rightPinnedWidth || 340}px`);
    workspace.classList.remove('is-right-unpinned');
    root.querySelector('.right-sidebar').classList.remove('is-panel-unpinned');
  }

  if (panel === 'attributes') {
    mapStage.style.setProperty('--attribute-panel-height', `${mapStage.dataset.attributePinnedHeight || 260}px`);
    mapStage.classList.remove('is-attributes-unpinned');
    root.querySelector('.attribute-panel').classList.remove('is-panel-unpinned');
  }

  updatePinButtons(root, panel, true);
  refreshViewers(viewerState);
}

function updatePinButtons(root, panel, isPinned) {
  root.querySelectorAll(`[data-pin-panel="${panel}"]`).forEach((button) => {
    button.setAttribute('aria-label', isPinned ? 'Unpin panel' : 'Pin panel');
    button.title = isPinned ? 'Unpin panel' : 'Pin panel';
    button.classList.toggle('is-unpinned', !isPinned);
  });
}

function isPanelUnpinned(root, panel) {
  if (panel === 'left') {
    return root.querySelector('.workspace').classList.contains('is-left-unpinned');
  }

  if (panel === 'right') {
    return root.querySelector('.workspace').classList.contains('is-right-unpinned');
  }

  return root.querySelector('.map-stage').classList.contains('is-attributes-unpinned');
}

function getNextPanelSize(event, resizeState) {
  if (resizeState.panel === 'left') {
    return clamp(resizeState.leftWidth + event.clientX - resizeState.startX, 220, Math.min(520, resizeState.workspaceWidth * 0.42));
  }

  if (resizeState.panel === 'right') {
    return clamp(resizeState.rightWidth - (event.clientX - resizeState.startX), 260, Math.min(560, resizeState.workspaceWidth * 0.44));
  }

  return clamp(resizeState.attributeHeight - (event.clientY - resizeState.startY), 150, Math.min(440, resizeState.mapStageHeight * 0.58));
}

function applyPanelSize(workspace, mapStage, panel, size) {
  if (panel === 'left') {
    workspace.style.setProperty('--left-panel-width', `${Math.round(size)}px`);
    return;
  }

  if (panel === 'right') {
    workspace.style.setProperty('--right-panel-width', `${Math.round(size)}px`);
    return;
  }

  mapStage.style.setProperty('--attribute-panel-height', `${Math.round(size)}px`);
}

function refreshViewers(viewerState) {
  window.requestAnimationFrame(() => {
    viewerState.map2D?.updateSize();
    viewerState.viewer3D?.resize();
  });
}

function getCssPixelValue(element, propertyName) {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(propertyName));
  return Number.isFinite(value) ? value : 0;
}

function getCurrentPanelSize(root, panel) {
  if (panel === 'left') {
    return getCssPixelValue(root.querySelector('.workspace'), '--left-panel-width') || root.querySelector('.left-sidebar').getBoundingClientRect().width;
  }

  if (panel === 'right') {
    return getCssPixelValue(root.querySelector('.workspace'), '--right-panel-width') || root.querySelector('.right-sidebar').getBoundingClientRect().width;
  }

  return getCssPixelValue(root.querySelector('.map-stage'), '--attribute-panel-height') || root.querySelector('.attribute-panel').getBoundingClientRect().height;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function renderIcons() {
  createIcons({
    icons,
    attrs: {
      'stroke-width': 1.8,
      'aria-hidden': 'true',
    },
  });
}

function syncLayerCheckboxes(root, layerId, isVisible) {
  root.querySelectorAll(`[data-layer-toggle="${CSS.escape(layerId)}"]`).forEach((checkbox) => {
    checkbox.checked = isVisible;
  });
}

function syncPresentationToolButtons(root, state) {
  const toolMap = {
    '[data-flight-path-toggle]': state.flightPath,
    '[data-night-mode-toggle]': state.nightOps,
  };

  Object.entries(toolMap).forEach(([selector, isActive]) => {
    root.querySelectorAll(selector).forEach((button) => {
      button.classList.toggle('is-active', Boolean(isActive));
      button.setAttribute('aria-pressed', String(Boolean(isActive)));
    });
  });
}

function initializeViewToggle(root, viewerState) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-view-mode]');

    if (!button) {
      return;
    }

    const viewMode = button.dataset.viewMode;
    if (viewMode === viewerState.activeView) {
      return;
    }

    if (viewMode === '3d') {
      await ensureMap3D(root, viewerState);
      switchTo3D(root, viewerState);
      return;
    }

    switchTo2D(root, viewerState);
  });
}

async function ensureMap3D(root, viewerState) {
  if (viewerState.viewer3D || viewerState.is3DInitializing) {
    return;
  }

  viewerState.is3DInitializing = true;

  const map3DState = await initializeMap3D({
    onLayersLoaded: (entityManager) => {
      viewerState.entityManager3D = entityManager;
      applyCurrentLayerVisibility(root, entityManager);
    },
    onFeatureSelect: (feature, layer) => {
      renderFeatureAttributes(root, feature, layer?.get('title') ?? 'Selected Feature');
    },
    onStatusChange: (status) => {
      updateStatus(root, status);
    },
    onLoadError: (error) => {
      renderTableMessage(root, error.message);
    },
  });

  viewerState.viewer3D = map3DState.viewer;
  viewerState.entityManager3D = map3DState.entityManager;
  applyCurrentLayerVisibility(root, viewerState.entityManager3D);
  viewerState.is3DInitializing = false;
}

function switchTo3D(root, viewerState) {
  const map2DContainer = root.querySelector('#map');

  viewerState.activeView = '3d';
  viewerState.measureTool2D?.setActive(false);
  root.querySelector('[data-measure-toggle]')?.classList.remove('is-active');
  root.querySelector('[data-measure-toggle]')?.setAttribute('aria-pressed', 'false');
  const measurePanel = root.querySelector('[data-measure-panel]');
  if (measurePanel) measurePanel.hidden = true;
  map2DContainer.hidden = true;
  setCesiumVisible(true);
  updateViewToggle(root, '3d');
  updateStatus(root, { mode: '3D', projection: 'WGS84' });
  if (viewerState.lastBuildingCheck) showBuildingCheck3D(viewerState.lastBuildingCheck, true);
  else flyToAirport3D();
}

function switchTo2D(root, viewerState) {
  const map2DContainer = root.querySelector('#map');

  viewerState.activeView = '2d';
  setCesiumVisible(false);
  setFlightPathExplanationVisible(false);
  setNightOperationsExplanationVisible(false);
  map2DContainer.hidden = false;
  viewerState.map2D?.updateSize();
  viewerState.layerManager2D?.zoomToLoadedData();
  updateViewToggle(root, '2d');
  updateStatus(root, { mode: '2D', projection: 'WGS84' });
}

function updateViewToggle(root, activeView) {
  root.querySelectorAll('[data-view-mode]').forEach((button) => {
    const isActive = button.dataset.viewMode === activeView;

    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function applyCurrentLayerVisibility(root, layerManager) {
  root.querySelectorAll('[data-layer-toggle]').forEach((checkbox) => {
    layerManager?.setVisible(checkbox.dataset.layerToggle, checkbox.checked);
  });
}

function updateStatus(root, status) {
  const fields = {
    projection: root.querySelector('[data-status-projection]'),
    lon: root.querySelector('[data-status-lon]'),
    lat: root.querySelector('[data-status-lat]'),
    scale: root.querySelector('[data-status-scale]'),
    mode: root.querySelector('[data-status-mode]'),
  };

  Object.entries(fields).forEach(([key, element]) => {
    if (element && status[key] !== undefined) {
      element.textContent = status[key];
    }
  });
}
