import { jsPDF } from 'jspdf';
import { createIcons, icons } from 'lucide';
import { loadGeoJson } from '../data/loader.js';
import { resolveOlsElevations } from '../data/olsElevation.js';
import { airportLayers } from '../config/airportLayers.js';
import { runwayPresentation } from '../layers/presentation.js';

const paperFormats = {
  A3: 'a3',
  A4: 'a4',
  Letter: 'letter',
};

const marginByLabel = {
  'Narrow 8 mm': 8,
  'Standard 12 mm': 12,
  'Wide 18 mm': 18,
};

export function initializeLayoutExport(root) {
  root.addEventListener('click', async (event) => {
    const orientationButton = event.target.closest('[data-layout-orientation]');

    if (orientationButton) {
      updateOrientationButtons(root, orientationButton);
      return;
    }

    const closePreviewButton = event.target.closest('[data-close-layout-preview]');

    if (closePreviewButton || event.target.matches('[data-layout-preview-modal]')) {
      closeLayoutPreview(root);
      return;
    }

    const downloadPreviewButton = event.target.closest('[data-download-preview-pdf]');

    if (downloadPreviewButton) {
      await exportPdfFromControls(root, downloadPreviewButton);
      return;
    }

    const previewButton = event.target.closest('[data-preview-pdf]');

    if (previewButton) {
      await previewPdfFromControls(root, previewButton);
      return;
    }

    const exportButton = event.target.closest('[data-export-pdf]');

    if (!exportButton) {
      return;
    }

    await exportPdfFromControls(root, exportButton);
  });
}

async function previewPdfFromControls(root, button) {
  const originalText = button.querySelector('span')?.textContent;

  setButtonBusy(button, 'Preparing...');

  try {
    const options = readLayoutOptions(root);
    const doc = await buildAirportMapPdfDocument(options);
    showLayoutPreview(root, doc.output('bloburl'));
  } catch (error) {
    console.error('PDF preview failed', error);
    window.alert(`PDF preview failed: ${error.message}`);
  } finally {
    setButtonReady(button, originalText);
  }
}

async function exportPdfFromControls(root, button) {
  const originalText = button.querySelector('span')?.textContent;

  setButtonBusy(button, 'Generating...');

  try {
    const options = readLayoutOptions(root);
    await generateAirportMapPdf(options);
  } catch (error) {
    console.error('PDF export failed', error);
    window.alert(`PDF export failed: ${error.message}`);
  } finally {
    setButtonReady(button, originalText);
  }
}

export async function generateAirportMapPdf(options) {
  const doc = await buildAirportMapPdfDocument(options);

  doc.save(`airport-gis-layout-${options.paper.toLowerCase()}-${options.orientation}.pdf`);
}

export async function buildAirportMapPdfDocument(options) {
  const configs = airportLayers.filter((config) => config.id !== 'runwayLine' && options.visibleLayerIds.includes(config.id));
  const layerData = await Promise.all(configs.map(async (config) => ({ config, geoJson: await loadGeoJson(config.path) })));
  const doc = new jsPDF({
    orientation: options.orientation,
    unit: 'mm',
    format: paperFormats[options.paper] ?? 'a3',
  });
  const page = {
    width: doc.internal.pageSize.getWidth(),
    height: doc.internal.pageSize.getHeight(),
  };
  const layout = createLayout(page, options.margin);
  const mapData = createMapData(layerData);

  drawPageBackground(doc, page);
  drawTitle(doc, layout.title, options);
  drawOverviewPanel(doc, layout.overview, mapData, options);
  drawPlanPanel(doc, layout.plan, mapData, options);
  drawProfilesPanel(doc, layout.profiles, mapData);
  drawApproachCharts(doc, layout.takeoff, mapData, options);
  drawAreaChart(doc, layout.area, mapData, options);
  drawFooter(doc, layout.footer, mapData);

  return doc;
}

function readLayoutOptions(root) {
  const enabledElements = {};

  root.querySelectorAll('[data-layout-option]').forEach((checkbox) => {
    enabledElements[checkbox.dataset.layoutOption] = checkbox.checked;
  });

  return {
    paper: root.querySelector('[data-layout-paper]')?.value ?? 'A3',
    orientation: root.querySelector('[data-layout-orientation].is-active')?.dataset.layoutOrientation ?? 'landscape',
    scale: root.querySelector('[data-layout-scale]')?.value ?? '1:25,000',
    margin: marginByLabel[root.querySelector('[data-layout-margins]')?.value] ?? 12,
    gridInterval: root.querySelector('[data-layout-grid-interval]')?.value ?? '1 km',
    enabledElements,
    visibleLayerIds: [...new Set([...root.querySelectorAll('[data-layer-toggle]:checked')].map((checkbox) => checkbox.dataset.layerToggle))],
  };
}

function updateOrientationButtons(root, activeButton) {
  root.querySelectorAll('[data-layout-orientation]').forEach((button) => {
    const isActive = button === activeButton;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function showLayoutPreview(root, blobUrl) {
  closeLayoutPreview(root);

  const modal = document.createElement('div');
  modal.className = 'layout-preview-modal';
  modal.dataset.layoutPreviewModal = 'true';
  modal.innerHTML = `
    <section class="layout-preview-dialog" role="dialog" aria-modal="true" aria-label="PDF layout preview">
      <header class="layout-preview-header">
        <div class="layout-preview-heading">
          <span class="layout-preview-icon"><i data-lucide="map"></i></span>
          <div>
            <span>Layout Preview</span>
            <strong>Airport GIS Presentation Map</strong>
          </div>
        </div>
        <div class="layout-preview-meta" aria-label="Document details">
          <span>PDF</span>
          <span>Print ready</span>
        </div>
        <div class="layout-preview-actions">
          <button class="secondary-button" type="button" data-download-preview-pdf>
            <i data-lucide="file-down"></i>
            <span>Export PDF</span>
          </button>
          <button class="icon-button" type="button" data-close-layout-preview aria-label="Close preview" title="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
      </header>
      <iframe class="layout-preview-frame" src="${blobUrl}" title="PDF layout preview"></iframe>
    </section>
  `;
  modal.dataset.previewBlobUrl = String(blobUrl);
  root.append(modal);
  window.requestAnimationFrame(() => modal.classList.add('is-visible'));

  createIcons({
    icons,
    attrs: {
      'stroke-width': 1.8,
      'aria-hidden': 'true',
    },
  });
}

function closeLayoutPreview(root) {
  const modal = root.querySelector('[data-layout-preview-modal]');

  if (!modal) {
    return;
  }

  const blobUrl = modal.dataset.previewBlobUrl;

  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
  }

  modal.remove();
}

function createLayout(page, margin) {
  const gap = 3;
  const headerHeight = 14;
  const footerHeight = 18;
  const bodyTop = margin + headerHeight;
  const bodyBottom = page.height - margin - footerHeight;
  const bodyHeight = bodyBottom - bodyTop;
  const topHeight = bodyHeight * 0.4;
  const profileHeight = bodyHeight * 0.2;
  const lowerHeight = bodyHeight - topHeight - profileHeight - gap * 2;
  const contentWidth = page.width - margin * 2;
  const leftWidth = contentWidth * 0.56;
  const rightWidth = contentWidth - leftWidth - gap;

  return {
    title: { x: margin, y: margin - 1, width: contentWidth, height: headerHeight },
    overview: { x: margin, y: bodyTop, width: leftWidth, height: topHeight },
    plan: { x: margin + leftWidth + gap, y: bodyTop, width: rightWidth, height: topHeight },
    profiles: { x: margin, y: bodyTop + topHeight + gap, width: contentWidth, height: profileHeight },
    takeoff: { x: margin, y: bodyTop + topHeight + profileHeight + gap * 2, width: leftWidth, height: lowerHeight },
    area: { x: margin + leftWidth + gap, y: bodyTop + topHeight + profileHeight + gap * 2, width: rightWidth, height: lowerHeight },
    footer: { x: margin, y: page.height - margin - footerHeight + gap, width: contentWidth, height: footerHeight - gap },
  };
}

function createMapData(layerData) {
  const decorate = (feature, layerId) => ({ ...feature, properties: { ...(feature.properties ?? {}), __LAYER_ID: layerId } });
  const runwayFeatures = layerData.find((entry) => entry.config.id === 'runway')?.geoJson.features ?? [];
  const olsById = layerData.filter((entry) => entry.config.id !== 'runway').map(({ config, geoJson }) => ({
    ostId: config.id,
    presentation: { label: config.title, solid: config.style2D.stroke, stroke: config.style2D.stroke },
    features: (geoJson.features ?? []).map((feature) => decorate(feature, config.id)),
  }));
  const olsFeatures = olsById.flatMap((group) => group.features);
  const extent = padExtent(getExtent([...runwayFeatures, ...olsFeatures]), 0.08);

  return {
    runwayFeatures,
    olsFeatures,
    olsById,
    extent,
  };
}

function drawPageBackground(doc, page) {
  setRgb(doc, 'fill', '#ffffff');
  doc.rect(0, 0, page.width, page.height, 'F');
}

function drawTitle(doc, layout, options) {
  if (!options.enabledElements.Title && options.enabledElements.Title !== undefined) {
    return;
  }

  doc.setFont('helvetica', 'bold');
  setRgb(doc, 'fill', '#0b4f73');
  doc.roundedRect(layout.x, layout.y - 2, 24, 8, 1.2, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6.2);
  doc.text('AIRPORT GIS', layout.x + 12, layout.y + 3, { align: 'center' });
  doc.setTextColor(15, 38, 64);
  doc.setFontSize(14);
  doc.text('ZENGILAN INTERNATIONAL AIRPORT', layout.x + layout.width / 2, layout.y + 2.8, { align: 'center' });
  doc.setFontSize(8);
  doc.setTextColor(63, 84, 105);
  doc.text('OBSTACLE LIMITATION SURFACES  /  PRESENTATION MAP', layout.x + layout.width / 2, layout.y + 9, { align: 'center' });
}

function drawOverviewPanel(doc, box, mapData, options) {
  drawPanel(doc, box, '1. OBSTACLE LIMITATION SURFACES (OLS) - OVERVIEW');
  const infoHeight = options.enabledElements.Legend ? 27 : 5;
  const mapBox = insetBox(box, 5, 9, 5, infoHeight + 2);
  drawSubtleMapBackground(doc, mapBox, false);
  drawOlsPolygons(doc, mapBox, mapData, { mode: 'overview' });
  drawRunway(doc, mapBox, mapData, 1.6);

  if (options.enabledElements.Legend) {
    drawLegend(doc, { x: box.x + 5, y: box.y + box.height - 25, width: box.width - 61, height: 21 }, mapData, { columns: 3 });
  }

  drawNote(doc, {
    x: box.x + box.width - 50,
    y: box.y + box.height - 25,
    width: 44,
    height: 21,
  }, 'Note: Surfaces are drawn from project GeoJSON. Diagram is illustrative.');
}

function drawPlanPanel(doc, box, mapData, options) {
  drawPanel(doc, box, '2. PLAN VIEW - OLS');
  const legendRail = options.enabledElements.Legend ? 54 : 5;
  const mapBox = insetBox(box, 5, 9, legendRail, 7);

  drawSubtleMapBackground(doc, mapBox, options.enabledElements['Coordinate Grid']);
  drawOlsPolygons(doc, mapBox, mapData, { mode: 'plan' });
  drawRunway(doc, mapBox, mapData, 1.4);

  if (options.enabledElements['North Arrow']) {
    drawNorthArrow(doc, mapBox.x + 8, mapBox.y + 14);
  }

  if (options.enabledElements.Legend) {
    drawLegend(doc, { x: box.x + box.width - 51, y: box.y + 10, width: 47, height: box.height - 20 }, mapData);
  }

  if (options.enabledElements['Scale Bar']) {
    drawScaleBar(doc, mapBox.x + mapBox.width - 31, mapBox.y + mapBox.height - 2, options.scale);
  }
}

function drawProfilesPanel(doc, box, mapData) {
  drawPanel(doc, box, '3. OBSTACLE LIMITATION SURFACES - PROFILE VIEWS');
  const inner = insetBox(box, 5, 10, 5, 5);
  const charts = [
    { title: '3.1 APPROACH SURFACE', ostId: 'approach03' },
    { title: '3.2 CONICAL SURFACE', ostId: 'conical' },
    { title: '3.3 INNER HORIZONTAL', ostId: 'innerHorizontal' },
    { title: '3.4 TAKE-OFF / TRANSITIONAL', ostId: 'takeoff03' },
  ];
  const chartGap = 3;
  const chartWidth = (inner.width - chartGap * (charts.length - 1)) / charts.length;

  charts.forEach((chart, index) => {
    const chartBox = {
      x: inner.x + index * (chartWidth + chartGap),
      y: inner.y,
      width: chartWidth,
      height: inner.height,
    };
    drawProfileChart(doc, chartBox, chart.title, chart.ostId, mapData);
  });
}

function drawApproachCharts(doc, box, mapData, options) {
  drawPanel(doc, box, '4. TYPE A OBSTACLE CHARTS - RUNWAY / APPROACH');
  const inner = insetBox(box, 5, 10, 5, 6);
  const halves = splitHorizontal(inner, 2, 3);
  const approachFeatures = mapData.olsFeatures.filter((feature) => ['approach03', 'approach21'].includes(feature.properties?.__LAYER_ID));

  halves.forEach((chartBox, index) => {
    const chartFeatures = approachFeatures.slice(index, index + 1);
    drawSubtleMapBackground(doc, chartBox, options.enabledElements['Coordinate Grid']);
    drawOlsPolygons(
      doc,
      chartBox,
      { ...mapData, olsFeatures: chartFeatures, olsById: groupFeaturesForDrawing(chartFeatures) },
      { mode: 'plan' },
    );
    drawRunway(doc, chartBox, mapData, 1.2);
    drawSmallLabel(doc, chartBox.x + 2, chartBox.y + 4, `4.${index + 1} APPROACH PATH`);
    drawScaleBar(doc, chartBox.x + chartBox.width - 34, chartBox.y + chartBox.height - 5, options.scale);
  });
}

function drawAreaChart(doc, box, mapData, options) {
  drawPanel(doc, box, '5. TYPE B AREA OBSTACLE CHART - AROUND AIRPORT');
  const mapBox = insetBox(box, 5, 10, 49, 8);

  drawSubtleMapBackground(doc, mapBox, options.enabledElements['Coordinate Grid']);
  drawConcentricCircles(doc, mapBox);
  drawOlsPolygons(doc, mapBox, mapData, { mode: 'plan', opacity: 0.18 });
  drawRunway(doc, mapBox, mapData, 1.1);

  if (options.enabledElements['North Arrow']) {
    drawNorthArrow(doc, mapBox.x + 7, mapBox.y + 11);
  }

  drawObstacleLegend(doc, { x: box.x + box.width - 45, y: box.y + 12, width: 41, height: 25 });
  drawNote(doc, {
    x: box.x + box.width - 44,
    y: box.y + box.height - 30,
    width: 41,
    height: 22,
  }, 'Heights are metres above aerodrome elevation. For illustration only.');
}

function drawFooter(doc, box) {
  const blocks = splitHorizontal(box, 3, 3);

  drawTextBox(doc, blocks[0], 'AIRPORT DATA', [
    'Runway and OLS data loaded from GeoJSON',
    'Reference code and official values: project source data',
    'Projection: EPSG:3857 / WGS84 display',
  ]);
  drawTextBox(doc, blocks[1], 'ABBREVIATIONS', [
    'THR - Threshold',
    'RWY - Runway',
    'OLS - Obstacle Limitation Surface',
    'm - metre',
  ]);
  drawTextBox(doc, blocks[2], 'DISCLAIMER', [
    'This map is generated by the Airport GIS prototype.',
    'It is suitable for presentation and not for operational use.',
  ]);
}

function drawPanel(doc, box, title) {
  setRgb(doc, 'fill', '#ffffff');
  setRgb(doc, 'draw', '#b8c7d3');
  doc.setLineWidth(0.18);
  doc.roundedRect(box.x, box.y, box.width, box.height, 1.2, 1.2, 'FD');
  setRgb(doc, 'fill', '#eef5f8');
  doc.roundedRect(box.x + 0.6, box.y + 0.6, box.width - 1.2, 6.7, 0.8, 0.8, 'F');
  setRgb(doc, 'fill', '#0b6f9f');
  doc.roundedRect(box.x + 1.5, box.y + 1.5, 2.2, 4.8, 0.7, 0.7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.7);
  doc.setTextColor(18, 56, 80);
  doc.text(title, box.x + 5.2, box.y + 4.9);
}

function drawSubtleMapBackground(doc, box, drawGrid) {
  setRgb(doc, 'fill', '#eef4ef');
  doc.rect(box.x, box.y, box.width, box.height, 'F');
  setRgb(doc, 'fill', '#cce4ee');
  doc.rect(box.x + box.width * 0.72, box.y, box.width * 0.28, box.height, 'F');
  setRgb(doc, 'draw', '#d4dce2');
  doc.setLineWidth(0.12);

  for (let i = 1; i < 9; i += 1) {
    const y = box.y + (box.height / 9) * i;
    doc.line(box.x, y + Math.sin(i) * 1.2, box.x + box.width, y + Math.cos(i) * 1.4);
  }

  if (!drawGrid) {
    return;
  }

  setRgb(doc, 'draw', '#cbd5df');
  doc.setLineWidth(0.08);
  for (let x = box.x + 10; x < box.x + box.width; x += 10) {
    doc.line(x, box.y, x, box.y + box.height);
  }
  for (let y = box.y + 10; y < box.y + box.height; y += 10) {
    doc.line(box.x, y, box.x + box.width, y);
  }
}

function drawOlsPolygons(doc, box, mapData, settings = {}) {
  const groups = mapData.olsById ?? groupFeaturesForDrawing(mapData.olsFeatures);
  const opacity = settings.opacity ?? 0.48;

  groups.forEach((group) => {
    const presentation = group.presentation;
    const fill = mixWithWhite(presentation.solid, 1 - opacity);
    const stroke = presentation.stroke;

    group.features.forEach((feature) => {
      getPolygonRings(feature).forEach((ring) => {
        const points = ring.map((coordinate) => projectCoordinate(coordinate, mapData.extent, box, settings.mode));

        setRgb(doc, 'fill', fill);
        setRgb(doc, 'draw', stroke);
        doc.setLineWidth(0.22);
        doc.lines(
          points.slice(1).map((point, index) => [point.x - points[index].x, point.y - points[index].y]),
          points[0].x,
          points[0].y,
          [1, 1],
          'FD',
        );

        if (settings.mode === 'overview') {
          drawElevationFace(doc, points, feature, presentation);
        }
      });
    });
  });
}

function drawElevationFace(doc, points, feature, presentation) {
  const { startElevation, endElevation } = resolveOlsElevations(feature.properties);
  const lift = Math.max(Math.abs(endElevation - startElevation), 8) * 0.025;
  const shifted = points.map((point) => ({ x: point.x + lift, y: point.y - lift }));

  setRgb(doc, 'fill', mixWithWhite(presentation.solid, 0.7));
  setRgb(doc, 'draw', presentation.stroke);
  doc.setLineWidth(0.12);

  for (let index = 0; index < points.length - 1; index += 1) {
    const quad = [points[index], points[index + 1], shifted[index + 1], shifted[index], points[index]];
    doc.lines(quad.slice(1).map((point, pointIndex) => [point.x - quad[pointIndex].x, point.y - quad[pointIndex].y]), quad[0].x, quad[0].y, [1, 1], 'FD');
  }
}

function drawRunway(doc, box, mapData, width) {
  setRgb(doc, 'draw', runwayPresentation.fill);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  doc.setLineWidth(width);

  mapData.runwayFeatures.forEach((feature) => {
    getLineStrings(feature).forEach((lineString) => {
      const points = lineString.map((coordinate) => projectCoordinate(coordinate, mapData.extent, box));
      for (let index = 0; index < points.length - 1; index += 1) {
        doc.line(points[index].x, points[index].y, points[index + 1].x, points[index + 1].y);
      }
    });
  });

  setRgb(doc, 'draw', '#ffffff');
  doc.setLineWidth(Math.max(width * 0.25, 0.25));
  mapData.runwayFeatures.forEach((feature) => {
    getLineStrings(feature).forEach((lineString) => {
      const points = lineString.map((coordinate) => projectCoordinate(coordinate, mapData.extent, box));
      for (let index = 0; index < points.length - 1; index += 1) {
        doc.line(points[index].x, points[index].y, points[index + 1].x, points[index + 1].y);
      }
    });
  });
}

function drawProfileChart(doc, box, title, ostId, mapData) {
  const group = mapData.olsById.find((item) => item.ostId === ostId);
  const feature = group?.features[0];
  const elevation = resolveOlsElevations(feature?.properties ?? {});
  const maxDistance = elevation.length || Number(feature?.properties?.RADIUS) || 3000;
  const maxElevation = Math.max(160, elevation.endElevation + 30);
  const color = group?.presentation.solid ?? '#64748b';
  const plot = insetBox(box, 6, 8, 5, 8);

  drawSmallLabel(doc, box.x + 1, box.y + 3, title, color);
  setRgb(doc, 'draw', '#6b7280');
  doc.setLineWidth(0.16);
  doc.line(plot.x, plot.y + plot.height, plot.x + plot.width, plot.y + plot.height);
  doc.line(plot.x, plot.y, plot.x, plot.y + plot.height);

  const start = pointInChart(plot, 0, elevation.startElevation, maxDistance, maxElevation);
  const end = pointInChart(plot, maxDistance, elevation.endElevation, maxDistance, maxElevation);

  setRgb(doc, 'fill', mixWithWhite(color, 0.65));
  setRgb(doc, 'draw', color);
  doc.setLineWidth(0.28);
  doc.lines([[end.x - start.x, end.y - start.y], [0, plot.y + plot.height - end.y], [plot.x - end.x, 0]], start.x, start.y, [1, 1], 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.8);
  doc.setTextColor(52, 64, 84);
  doc.text(`Slope ${formatNumber(elevation.slopePercent)}%`, plot.x + plot.width * 0.48, plot.y + 8, { align: 'center' });
  doc.text(`${Math.round(maxDistance)} m`, plot.x + plot.width / 2, box.y + box.height - 1.5, { align: 'center' });
}

function drawLegend(doc, box, mapData, settings = {}) {
  const items = [
    { color: '#262b33', label: 'Runway' },
    ...mapData.olsById.map((group) => ({ color: group.presentation.solid, label: group.presentation.label })),
  ];
  const columns = Math.max(1, settings.columns ?? 1);
  const rowsPerColumn = Math.ceil(items.length / columns);
  const columnWidth = (box.width - 6) / columns;

  drawLegendBox(doc, box, 'MAP LEGEND', `${items.length} visible layers`);
  items.forEach((item, index) => {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    drawLegendItem(doc, box.x + 3 + column * columnWidth, box.y + 9 + row * 4.4, item.color, item.label);
  });
}

function drawObstacleLegend(doc, box) {
  drawLegendBox(doc, box, 'OBSTACLE STATUS', 'OLS classification');
  drawLegendDot(doc, box.x + 5, box.y + 11, '#31a354', 'No obstacle');
  drawLegendDot(doc, box.x + 5, box.y + 16, '#e9a820', 'Below OLS');
  drawLegendDot(doc, box.x + 5, box.y + 21, '#dc3c3c', 'Penetrating OLS');
}

function drawLegendBox(doc, box, title, subtitle = '') {
  setRgb(doc, 'fill', '#fbfcfd');
  setRgb(doc, 'draw', '#aebdca');
  doc.roundedRect(box.x, box.y, box.width, box.height, 1.2, 1.2, 'FD');
  setRgb(doc, 'fill', '#0b6f9f');
  doc.roundedRect(box.x, box.y, 1.6, box.height, 0.8, 0.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.8);
  doc.setTextColor(18, 56, 80);
  doc.text(title, box.x + 3.2, box.y + 4.1);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(3.8);
    doc.setTextColor(103, 119, 132);
    doc.text(subtitle, box.x + box.width - 2.5, box.y + 4.1, { align: 'right' });
  }
  setRgb(doc, 'draw', '#dce4e9');
  doc.setLineWidth(0.12);
  doc.line(box.x + 3, box.y + 6.2, box.x + box.width - 2.5, box.y + 6.2);
}

function drawLegendItem(doc, x, y, color, label) {
  setRgb(doc, 'fill', mixWithWhite(color, 0.38));
  setRgb(doc, 'draw', color);
  doc.roundedRect(x, y - 2.5, 4.2, 3.1, 0.35, 0.35, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.1);
  doc.setTextColor(52, 64, 84);
  doc.text(label, x + 5.7, y);
}

function drawLegendDot(doc, x, y, color, label) {
  setRgb(doc, 'fill', color);
  doc.circle(x, y - 1, 1.3, 'F');
  setRgb(doc, 'draw', mixWithWhite(color, 0.2));
  doc.circle(x, y - 1, 1.8, 'S');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.2);
  doc.setTextColor(52, 64, 84);
  doc.text(label, x + 4, y);
}

function drawNorthArrow(doc, x, y) {
  setRgb(doc, 'fill', '#0f172a');
  doc.triangle(x, y - 7, x - 1.5, y, x + 1.5, y, 'F');
  doc.setLineWidth(0.2);
  doc.line(x, y, x, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.text('N', x, y + 10, { align: 'center' });
}

function drawScaleBar(doc, x, y, scale) {
  const segment = 7;

  for (let index = 0; index < 4; index += 1) {
    setRgb(doc, 'fill', index % 2 === 0 ? '#111827' : '#ffffff');
    setRgb(doc, 'draw', '#111827');
    doc.rect(x + index * segment, y - 3, segment, 3, 'FD');
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4);
  doc.setTextColor(17, 24, 39);
  doc.text(scale, x + segment * 2, y + 2.8, { align: 'center' });
}

function drawConcentricCircles(doc, box) {
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  setRgb(doc, 'draw', '#6b7280');
  doc.setLineDashPattern([1.2, 1.2], 0);
  [0.22, 0.38, 0.54].forEach((ratio) => {
    doc.circle(center.x, center.y, Math.min(box.width, box.height) * ratio, 'S');
  });
  doc.setLineDashPattern([], 0);
}

function drawNote(doc, box, text) {
  drawTextBox(doc, box, 'NOTE', [text]);
}

function drawTextBox(doc, box, title, lines) {
  setRgb(doc, 'fill', '#ffffff');
  setRgb(doc, 'draw', '#b9c5d2');
  doc.roundedRect(box.x, box.y, box.width, box.height, 0.8, 0.8, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.7);
  doc.setTextColor(18, 99, 143);
  doc.text(title, box.x + 2.5, box.y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.3);
  doc.setTextColor(29, 41, 57);
  doc.text(lines.flatMap((line) => doc.splitTextToSize(line, box.width - 5)), box.x + 2.5, box.y + 8);
}

function drawSmallLabel(doc, x, y, text, color = '#0f5f8c') {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  setRgb(doc, 'text', color);
  doc.text(text, x, y);
}

function pointInChart(box, x, y, maxX, maxY) {
  return {
    x: box.x + (x / maxX) * box.width,
    y: box.y + box.height - (y / maxY) * box.height,
  };
}

function getPolygonRings(feature) {
  const geometry = feature.geometry;

  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates;
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat();
  }

  return [];
}

function getLineStrings(feature) {
  const geometry = feature.geometry;

  if (!geometry) {
    return [];
  }

  if (geometry.type === 'LineString') {
    return [geometry.coordinates];
  }

  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates;
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates;
  }

  return [];
}

function getExtent(features) {
  const coordinates = features.flatMap((feature) => getAllCoordinates(feature.geometry));
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function getAllCoordinates(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Point') {
    return [geometry.coordinates];
  }

  if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
    return geometry.coordinates;
  }

  if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
    return geometry.coordinates.flat();
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat(2);
  }

  return [];
}

function projectCoordinate(coordinate, extent, box, mode = 'plan') {
  const width = Math.max(extent.maxX - extent.minX, 0.000001);
  const height = Math.max(extent.maxY - extent.minY, 0.000001);
  const scale = Math.min(box.width / width, box.height / height);
  const contentWidth = width * scale;
  const contentHeight = height * scale;
  const x = box.x + (box.width - contentWidth) / 2 + (coordinate[0] - extent.minX) * scale;
  const y = box.y + box.height - (box.height - contentHeight) / 2 - (coordinate[1] - extent.minY) * scale;

  if (mode !== 'overview') {
    return { x, y };
  }

  const skew = (x - (box.x + box.width / 2)) * 0.08;
  return { x, y: y * 0.82 + box.y * 0.18 + skew };
}

function padExtent(extent, ratio) {
  const width = extent.maxX - extent.minX || 0.01;
  const height = extent.maxY - extent.minY || 0.01;

  return {
    minX: extent.minX - width * ratio,
    minY: extent.minY - height * ratio,
    maxX: extent.maxX + width * ratio,
    maxY: extent.maxY + height * ratio,
  };
}

function groupFeaturesForDrawing(features) {
  const ostIds = [...new Set(features.map((feature) => String(feature.properties?.__LAYER_ID ?? 'unknown')))];
  return ostIds.map((ostId) => {
    const config = airportLayers.find((item) => item.id === ostId);
    return {
    ostId,
    presentation: { label: config?.title ?? ostId, solid: config?.style2D.stroke ?? '#64748b', stroke: config?.style2D.stroke ?? '#64748b' },
    features: features.filter((feature) => String(feature.properties?.__LAYER_ID ?? 'unknown') === ostId),
  };
  });
}

function splitHorizontal(box, count, gap) {
  const itemWidth = (box.width - gap * (count - 1)) / count;

  return Array.from({ length: count }, (_, index) => ({
    x: box.x + index * (itemWidth + gap),
    y: box.y,
    width: itemWidth,
    height: box.height,
  }));
}

function insetBox(box, left, top, right, bottom) {
  return {
    x: box.x + left,
    y: box.y + top,
    width: box.width - left - right,
    height: box.height - top - bottom,
  };
}

function setButtonBusy(button, label) {
  button.disabled = true;
  const labelElement = button.querySelector('span');

  if (labelElement) {
    labelElement.textContent = label;
  }
}

function setButtonReady(button, label) {
  button.disabled = false;
  const labelElement = button.querySelector('span');

  if (labelElement && label) {
    labelElement.textContent = label;
  }
}

function mixWithWhite(hex, whiteRatio) {
  const color = hexToRgb(hex);
  const mix = (value) => Math.round(value + (255 - value) * whiteRatio);

  return [mix(color.r), mix(color.g), mix(color.b)];
}

function setRgb(doc, target, color) {
  const rgb = Array.isArray(color) ? { r: color[0], g: color[1], b: color[2] } : hexToRgb(color);

  if (target === 'fill') {
    doc.setFillColor(rgb.r, rgb.g, rgb.b);
    return;
  }

  if (target === 'draw') {
    doc.setDrawColor(rgb.r, rgb.g, rgb.b);
    return;
  }

  doc.setTextColor(rgb.r, rgb.g, rgb.b);
}

function hexToRgb(color) {
  if (color.startsWith('rgba')) {
    const [r, g, b] = color.match(/\d+(\.\d+)?/g).map(Number);
    return { r, g, b };
  }

  const value = color.replace('#', '');
  const numeric = Number.parseInt(value, 16);

  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255,
  };
}

function formatNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '--';
}
