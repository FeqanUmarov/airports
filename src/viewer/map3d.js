import * as Cesium from 'cesium';
import { EntityManager, getEntityAttributes } from '../cesium/entityManager.js';

let viewer;
let entityManager;
let activeTour = null;
let activeStory = null;
let activeConstructionDemo = null;
let identifyModeEnabled = false;
let buildingCheckEntities = [];

export function setIdentifyMode3D(isEnabled) {
  identifyModeEnabled = Boolean(isEnabled);
  const container = document.querySelector('#cesium-map');
  container?.classList.toggle('is-identifying', identifyModeEnabled);
  if (!identifyModeEnabled) container?.querySelector('.cesium-popup')?.setAttribute('hidden', '');
}

export async function initializeMap3D({
  target = 'cesium-map',
  onLayersLoaded,
  onFeatureSelect,
  onLoadError,
  onStatusChange,
} = {}) {
  if (!viewer) {
    viewer = createViewer(target);
    entityManager = new EntityManager(viewer);
    initializeSelection({ viewer, onFeatureSelect });
    initializeStatusTracking({ viewer, onStatusChange });

    try {
      await entityManager.loadAirportLayers();

      await entityManager.flyToAirport();
      onLayersLoaded?.(entityManager);
    } catch (error) {
      onLoadError?.(error);
    }
  }

  return { viewer, entityManager };
}

export function setCesiumVisible(isVisible) {
  const container = document.querySelector('#cesium-map');

  if (!container) {
    return;
  }

  container.hidden = !isVisible;

  if (isVisible && viewer) {
    viewer.resize();
  }
}

export function showBuildingCheck3D(result, flyTo = true) {
  if (!viewer || !result?.coordinates?.length) return;
  clearBuildingCheck3D();
  const topElevation = result.buildingTopElevation;
  const footprintEntity = viewer.entities.add({
    name: 'Checked Building', layerId: 'building-check-3d', layerTitle: 'Building Check',
    properties: { HEIGHT_M: result.heightMeters, STATUS: result.violation ? 'OLS VIOLATION' : 'CLEAR' },
    polygon: {
      hierarchy: createPolygonHierarchy([result.coordinates]), height: 1.5, extrudedHeight: topElevation,
      material: Cesium.Color.fromCssColorString(result.violation ? '#3b82f6' : '#22c55e').withAlpha(0.62),
      outline: true, outlineColor: Cesium.Color.WHITE,
    },
  });
  buildingCheckEntities.push(footprintEntity);

  result.conflictPolygons.forEach((conflict, index) => {
    buildingCheckEntities.push(viewer.entities.add({
      name: `Conflict — ${conflict.layerTitle}`, layerId: `building-conflict-${conflict.layerId}`, layerTitle: conflict.layerTitle,
      properties: { SURFACE: conflict.layerTitle, STATUS: 'VIOLATION', BUILDING_HEIGHT_M: result.heightMeters },
      polygon: {
        hierarchy: createPolygonHierarchy(conflict.coordinates), height: 1.55, extrudedHeight: topElevation + 0.35,
        material: Cesium.Color.RED.withAlpha(0.72), outline: true, outlineColor: Cesium.Color.YELLOW,
      },
      label: index === 0 ? {
        text: `OLS CONFLICT\n${conflict.layerTitle}`, font: '600 14px sans-serif', fillColor: Cesium.Color.WHITE,
        showBackground: true, backgroundColor: Cesium.Color.DARKRED.withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, -34), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      } : undefined,
      position: index === 0 ? conflictCenter(conflict.coordinates, topElevation + 2) : undefined,
    }));
  });

  if (flyTo) viewer.flyTo(footprintEntity, {
    offset: new Cesium.HeadingPitchRange(0, -0.65, Math.max(350, result.heightMeters * 7)), duration: 1.2,
  });
}

export function clearBuildingCheck3D() {
  if (!viewer) return;
  buildingCheckEntities.forEach((entity) => viewer.entities.remove(entity));
  buildingCheckEntities = [];
}

function createPolygonHierarchy(rings) {
  const toPositions = (ring) => Cesium.Cartesian3.fromDegreesArray(ring.flatMap((coordinate) => coordinate.slice(0, 2)));
  return new Cesium.PolygonHierarchy(toPositions(rings[0]), rings.slice(1).map((hole) => new Cesium.PolygonHierarchy(toPositions(hole))));
}

function conflictCenter(rings, height) {
  const ring = rings[0];
  const longitude = ring.reduce((sum, coordinate) => sum + coordinate[0], 0) / ring.length;
  const latitude = ring.reduce((sum, coordinate) => sum + coordinate[1], 0) / ring.length;
  return Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
}

export async function flyToAirport3D() {
  await entityManager?.flyToAirport();
}

export async function startPresentationTour3D({
  onStart,
  onStop,
  onStep,
} = {}) {
  if (!viewer || !entityManager) {
    return;
  }

  stopPresentationTour3D();

  activeTour = {
    cancelled: false,
    overlay: createTourOverlay(),
  };

  onStart?.();

  try {
    const viewpoints = createPresentationViewpoints(entityManager);

    for (const viewpoint of viewpoints) {
      if (activeTour.cancelled) {
        break;
      }

      onStep?.(viewpoint);
      updateTourOverlay(activeTour.overlay, viewpoint);
      await flyToViewpoint(viewer, viewpoint, activeTour);
      await wait(650, activeTour);
    }
  } finally {
    removeTourOverlay(activeTour?.overlay);
    activeTour = null;
    onStop?.();
  }
}

export async function startSafetyStory3D({
  onStateChange,
  onStop,
} = {}) {
  if (!viewer || !entityManager) {
    return;
  }

  stopPresentationTour3D();
  stopSafetyStory3D();

  activeStory = {
    cancelled: false,
    overlay: createStoryOverlay(),
  };

  const storyState = {
    flightPath: false,
    nightOps: false,
  };

  const setStoryState = async (nextState) => {
    Object.assign(storyState, nextState);

    await Promise.all([
      entityManager.setFlightPathDemoVisible(storyState.flightPath),
      entityManager.setNightOperationsVisible(storyState.nightOps),
    ]);

    setFlightPathExplanationVisible(storyState.flightPath);
    setNightOperationsExplanationVisible(storyState.nightOps);
    onStateChange?.({ ...storyState });
  };

  try {
    const storySteps = createSafetyStorySteps(entityManager);

    for (const [index, step] of storySteps.entries()) {
      if (activeStory.cancelled) {
        break;
      }

      await setStoryState(step.state);
      updateStoryOverlay(activeStory.overlay, step, index + 1, storySteps.length);
      await flyToViewpoint(viewer, step, activeStory);
      await wait(step.hold ?? 1200, activeStory);
    }
  } finally {
    removeTourOverlay(activeStory?.overlay);
    activeStory = null;
    onStop?.();
  }
}

export async function startConstructionConflictDemo3D({
  onStop,
} = {}) {
  if (!viewer || !entityManager) {
    return;
  }

  stopPresentationTour3D();
  stopSafetyStory3D();
  stopConstructionConflictDemo3D();

  activeConstructionDemo = {
    cancelled: false,
    overlay: createConstructionConflictOverlay(),
  };

  try {
    await entityManager.setConstructionConflictVisible(true);
    updateConstructionConflictOverlay(activeConstructionDemo.overlay, 'review');

    const conflictSphere = entityManager.getLayerBoundingSphere('construction-conflict')
      ?? entityManager.getAirportBoundingSphere();
    const runwayHeading = entityManager.getRunwayHeading();

    if (conflictSphere) {
      await flyToViewpoint(viewer, {
        sphere: conflictSphere,
        heading: runwayHeading - Cesium.Math.toRadians(38),
        pitch: Cesium.Math.toRadians(-29),
        range: Math.max(conflictSphere.radius * 5.4, 950),
        duration: 1.8,
      }, activeConstructionDemo);
    }

    await wait(2600, activeConstructionDemo);
    updateConstructionConflictOverlay(activeConstructionDemo.overlay, 'violation');
    await wait(3000, activeConstructionDemo);
    updateConstructionConflictOverlay(activeConstructionDemo.overlay, 'rejected');
    await wait(3300, activeConstructionDemo);
  } finally {
    await entityManager?.setConstructionConflictVisible(false);
    removeConstructionConflictOverlay(activeConstructionDemo?.overlay);
    activeConstructionDemo = null;
    onStop?.();
  }
}

export function stopConstructionConflictDemo3D() {
  if (!activeConstructionDemo) {
    return;
  }

  activeConstructionDemo.cancelled = true;
  viewer?.camera.cancelFlight();
  removeConstructionConflictOverlay(activeConstructionDemo.overlay);
  activeConstructionDemo = null;
}

export function stopSafetyStory3D() {
  if (!activeStory) {
    return;
  }

  activeStory.cancelled = true;
  viewer?.camera.cancelFlight();
  removeTourOverlay(activeStory.overlay);
  activeStory = null;
}

export function stopPresentationTour3D() {
  if (!activeTour) {
    return;
  }

  activeTour.cancelled = true;
  viewer?.camera.cancelFlight();
  removeTourOverlay(activeTour.overlay);
  activeTour = null;
}

export function setObstacleExplanationVisible(isVisible) {
  if (isVisible) {
    showObstacleExplanation();
    return;
  }

  hideObstacleExplanation();
}

export function setFlightPathExplanationVisible(isVisible) {
  if (isVisible) {
    showFlightPathExplanation();
    return;
  }

  hideFlightPathExplanation();
}

export function setNightOperationsExplanationVisible(isVisible) {
  if (isVisible) {
    showNightOperationsExplanation();
    return;
  }

  hideNightOperationsExplanation();
}

export function setExplodedOlsExplanationVisible(isVisible) {
  if (isVisible) {
    showExplodedOlsExplanation();
    return;
  }

  hideExplodedOlsExplanation();
}

function createViewer(target) {
  const creditContainer = createCreditContainer(target);
  const cesiumViewer = new Cesium.Viewer(target, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    creditContainer,
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
      ),
    ),
  });

  addSatelliteImagery(cesiumViewer);
  cesiumViewer.scene.globe.depthTestAgainstTerrain = false;
  cesiumViewer.scene.postProcessStages.fxaa.enabled = true;
  cesiumViewer.scene.globe.maximumScreenSpaceError = 1.4;
  cesiumViewer.scene.screenSpaceCameraController.enableRotate = true;
  cesiumViewer.scene.screenSpaceCameraController.enableTilt = true;
  cesiumViewer.scene.screenSpaceCameraController.enableTranslate = true;
  cesiumViewer.scene.screenSpaceCameraController.enableZoom = true;

  return cesiumViewer;
}

function createPresentationViewpoints(manager) {
  const airportSphere = manager.getAirportBoundingSphere();
  const runwaySphere = manager.getLayerBoundingSphere('runway') ?? airportSphere;
  const approachSphere = manager.getLayerBoundingSphere('approach03') ?? airportSphere;
  const obstacleSphere = manager.isLayerVisible('obstacles') ? manager.getLayerBoundingSphere('obstacles') : null;
  const runwayHeading = manager.getRunwayHeading();

  if (!airportSphere) {
    return [];
  }

  const viewpoints = [
    {
      title: 'Hava limanına ümumi baxış',
      subtitle: 'Uçuş zolağı və maneə məhdudlaşdırma səthlərinin ümumi görünüşü',
      sphere: airportSphere,
      heading: runwayHeading - Cesium.Math.PI_OVER_TWO,
      pitch: Cesium.Math.toRadians(-58),
      range: Math.max(airportSphere.radius * 3.1, 4200),
      duration: 2.4,
    },
    {
      title: 'Uçuş zolağının oxu',
      subtitle: 'Uçuş zolağı istiqaməti boyunca aşağı bucaqlı baxış',
      sphere: runwaySphere,
      heading: runwayHeading,
      pitch: Cesium.Math.toRadians(-24),
      range: Math.max(runwaySphere.radius * 2.4, 1800),
      duration: 2.8,
    },
    {
      title: 'Yanaşma səthi',
      subtitle: 'En, meyillilik və yüksəklik dəyərləri OLS GeoJSON atributlarından oxunur',
      sphere: approachSphere,
      heading: runwayHeading,
      pitch: Cesium.Math.toRadians(-34),
      range: Math.max(approachSphere.radius * 1.9, 2600),
      duration: 2.8,
    },
    ...(obstacleSphere ? [{
      title: 'Maneə pozuntusu demosu',
      subtitle: 'Qırmızı markerlər seçilmiş OLS qoruma zonasını aşan obyektləri göstərir',
      sphere: obstacleSphere,
      heading: runwayHeading - Cesium.Math.toRadians(25),
      pitch: Cesium.Math.toRadians(-30),
      range: Math.max(obstacleSphere.radius * 2.8, 1500),
      duration: 2.5,
    }] : []),
    {
      title: 'OLS 3D strukturu',
      subtitle: 'Şəffaf səthlər başlanğıc və son yüksəklikləri 3D formada göstərir',
      sphere: airportSphere,
      heading: runwayHeading + Cesium.Math.PI_OVER_TWO,
      pitch: Cesium.Math.toRadians(-43),
      range: Math.max(airportSphere.radius * 2.55, 3600),
      duration: 2.6,
    },
    {
      title: 'Təqdimat görünüşü',
      subtitle: 'Yoxlama, seçim və PDF layout export üçün hazır görünüş',
      sphere: airportSphere,
      heading: runwayHeading - Cesium.Math.toRadians(35),
      pitch: Cesium.Math.toRadians(-48),
      range: Math.max(airportSphere.radius * 2.85, 4200),
      duration: 2.2,
    },
  ];

  return viewpoints;
}

function createSafetyStorySteps(manager) {
  const airportSphere = manager.getAirportBoundingSphere();
  const runwaySphere = manager.getLayerBoundingSphere('runway') ?? airportSphere;
  const approachSphere = manager.getLayerBoundingSphere('approach03') ?? airportSphere;
  const runwayHeading = manager.getRunwayHeading();

  if (!airportSphere) {
    return [];
  }

  return [
    {
      title: '1. Uçuş zolağının əsası',
      subtitle: 'Təqdimat uçuş zolağından başlayır: təyyarə hərəkəti və təhlükəsizlik səthləri bu ox üzrə qurulur.',
      sphere: runwaySphere,
      heading: runwayHeading,
      pitch: Cesium.Math.toRadians(-26),
      range: Math.max(runwaySphere.radius * 2.2, 1800),
      duration: 2,
      hold: 950,
      state: {
        obstacles: false,
        flightPath: false,
        nightOps: false,
        olsExploded: false,
      },
    },
    {
      title: '2. OLS qoruma zonası',
      subtitle: 'Şəffaf 3D OLS poliqonları hava limanı ətrafındakı qorunan hava məkanını göstərir.',
      sphere: airportSphere,
      heading: runwayHeading - Cesium.Math.PI_OVER_TWO,
      pitch: Cesium.Math.toRadians(-50),
      range: Math.max(airportSphere.radius * 2.75, 4300),
      duration: 2.3,
      state: {
        obstacles: false,
        flightPath: false,
        nightOps: false,
        olsExploded: false,
      },
    },
    {
      title: '3. Uçuş trayektoriyası',
      subtitle: 'Təyyarə əvvəl uçuş zolağı üzərində hərəkət edir, sonra qorunan yanaşma koridoru ilə qalxır.',
      sphere: approachSphere,
      heading: runwayHeading,
      pitch: Cesium.Math.toRadians(-29),
      range: Math.max(approachSphere.radius * 1.8, 2600),
      duration: 2.4,
      hold: 2200,
      state: {
        obstacles: false,
        flightPath: true,
        nightOps: false,
        olsExploded: false,
      },
    },
    {
      title: '4. Maneə riski yoxlaması',
      subtitle: 'Demo markerlər yaxın obyektlərin OLS zonasından aşağıda, yaxınında və ya onu pozduğunu göstərir.',
      sphere: airportSphere,
      heading: runwayHeading - Cesium.Math.toRadians(28),
      pitch: Cesium.Math.toRadians(-35),
      range: Math.max(airportSphere.radius * 2.25, 3500),
      duration: 2.3,
      state: {
        obstacles: true,
        flightPath: true,
        nightOps: false,
        olsExploded: false,
      },
    },
    {
      title: '5. Gecə əməliyyatları',
      subtitle: 'Yaradılmış uçuş zolağı işıqları eyni təhlükəsizlik mənzərəsini gecə təqdimatı üçün oxunaqlı edir.',
      sphere: runwaySphere,
      heading: runwayHeading,
      pitch: Cesium.Math.toRadians(-21),
      range: Math.max(runwaySphere.radius * 2, 1900),
      duration: 2.2,
      hold: 1500,
      state: {
        obstacles: true,
        flightPath: true,
        nightOps: true,
        olsExploded: false,
      },
    },
    {
      title: '6. Texniki OLS ayrımı',
      subtitle: 'Eyni OLS layer-lər şaquli ayrılır ki, hər səth ayrıca daha aydın oxunsun.',
      sphere: airportSphere,
      heading: runwayHeading + Cesium.Math.PI_OVER_TWO,
      pitch: Cesium.Math.toRadians(-48),
      range: Math.max(airportSphere.radius * 3.2, 5200),
      duration: 2.5,
      hold: 1600,
      state: {
        obstacles: false,
        flightPath: false,
        nightOps: true,
        olsExploded: true,
      },
    },
    {
      title: 'Final təqdimat görünüşü',
      subtitle: 'Ssenari hava limanını flight path açıq olan təmiz 3D yoxlama görünüşündə saxlayır.',
      sphere: airportSphere,
      heading: runwayHeading - Cesium.Math.toRadians(35),
      pitch: Cesium.Math.toRadians(-47),
      range: Math.max(airportSphere.radius * 2.85, 4300),
      duration: 2.2,
      hold: 1000,
      state: {
        obstacles: true,
        flightPath: true,
        nightOps: false,
        olsExploded: false,
      },
    },
  ].filter((step) => !step.title.startsWith('4.') && !step.title.startsWith('6.'));
}

function flyToViewpoint(cesiumViewer, viewpoint, tourState) {
  return new Promise((resolve) => {
    if (tourState.cancelled) {
      resolve();
      return;
    }

    cesiumViewer.camera.flyToBoundingSphere(viewpoint.sphere, {
      duration: viewpoint.duration,
      offset: new Cesium.HeadingPitchRange(viewpoint.heading, viewpoint.pitch, viewpoint.range),
      easingFunction: Cesium.EasingFunction.SINE_IN_OUT,
      complete: resolve,
      cancel: resolve,
    });
  });
}

function createStoryOverlay() {
  const container = document.querySelector('#cesium-map');
  let overlay = container?.querySelector('.story-overlay');

  if (!overlay && container) {
    overlay = document.createElement('div');
    overlay.className = 'tour-overlay story-overlay';
    overlay.innerHTML = `
      <span class="tour-kicker">Hava Limanı Təhlükəsizlik Ssenarisi</span>
      <strong data-story-title></strong>
      <small data-story-subtitle></small>
      <div class="story-progress" aria-hidden="true">
        <span data-story-progress></span>
      </div>
    `;
    container.append(overlay);
  }

  window.requestAnimationFrame(() => overlay?.classList.add('is-visible'));
  return overlay;
}

function createConstructionConflictOverlay() {
  const container = document.querySelector('#cesium-map');
  let overlay = container?.querySelector('.construction-conflict-overlay');

  if (!overlay && container) {
    overlay = document.createElement('div');
    overlay.className = 'construction-conflict-overlay';
    overlay.innerHTML = `
      <div class="conflict-status-icon" data-conflict-icon></div>
      <div>
        <span class="tour-kicker">Tikinti Konflikti Demosu</span>
        <strong data-conflict-title></strong>
        <small data-conflict-message></small>
      </div>
      <div class="conflict-meter" aria-hidden="true">
        <span data-conflict-meter></span>
      </div>
    `;
    container.append(overlay);
  }

  window.requestAnimationFrame(() => overlay?.classList.add('is-visible'));
  return overlay;
}

function createTourOverlay() {
  const container = document.querySelector('#cesium-map');
  let overlay = container?.querySelector('.tour-overlay');

  if (!overlay && container) {
    overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.innerHTML = `
      <span class="tour-kicker">3D Təqdimat Turu</span>
      <strong data-tour-title></strong>
      <small data-tour-subtitle></small>
    `;
    container.append(overlay);
  }

  window.requestAnimationFrame(() => overlay?.classList.add('is-visible'));
  return overlay;
}

function updateConstructionConflictOverlay(overlay, state) {
  if (!overlay) {
    return;
  }

  const content = {
    review: {
      title: 'Təklif olunan bina tikilir',
      message: 'Bina uçuş zolağı yaxınlığında qalxır və qorunan OLS zonası görünür qalır.',
      progress: '38%',
    },
    violation: {
      title: 'OLS POZUNTUSU AŞKARLANDI',
      message: 'Təklif olunan bina qorunan hava məkanına daxil olur. Bu zonada tikintiyə icazə verilmir.',
      progress: '72%',
    },
    rejected: {
      title: 'Təklif rədd edildi',
      message: 'Bina təhlükəsizlik buferindən çıxarılır və səhnə normal yoxlama rejiminə qayıdır.',
      progress: '100%',
    },
  }[state];

  overlay.dataset.state = state;
  overlay.querySelector('[data-conflict-title]').textContent = content.title;
  overlay.querySelector('[data-conflict-message]').textContent = content.message;
  overlay.querySelector('[data-conflict-meter]').style.width = content.progress;
}

function updateStoryOverlay(overlay, step, index, total) {
  if (!overlay) {
    return;
  }

  overlay.querySelector('[data-story-title]').textContent = step.title;
  overlay.querySelector('[data-story-subtitle]').textContent = step.subtitle;
  overlay.querySelector('[data-story-progress]').style.width = `${Math.round((index / total) * 100)}%`;
}

function removeConstructionConflictOverlay(overlay) {
  if (!overlay) {
    return;
  }

  overlay.classList.remove('is-visible');
  window.setTimeout(() => overlay.remove(), 180);
}

function showObstacleExplanation() {
  const container = document.querySelector('#cesium-map');
  let panel = container?.querySelector('.obstacle-explanation');

  if (!panel && container) {
    panel = document.createElement('div');
    panel.className = 'obstacle-explanation';
    panel.innerHTML = `
      <div>
        <span class="tour-kicker">Maneə Təhlükəsizliyi Demosu</span>
        <strong>OLS clearance yoxlaması</strong>
        <small>Hər marker maneə hündürlüyünü həmin nöqtədəki OLS səth yüksəkliyi ilə müqayisə edir.</small>
      </div>
      <div class="obstacle-formula">
        Clearance = OLS yüksəkliyi - Maneə hündürlüyü
      </div>
      <div class="obstacle-legend" aria-label="Obstacle status legend">
        <span><i class="status-dot safe"></i>Təhlükəsiz: OLS-dən aşağıdır</span>
        <span><i class="status-dot warning"></i>Yaxın: clearance azdır</span>
        <span><i class="status-dot danger"></i>Pozuntu: OLS-dən yuxarıdır</span>
      </div>
      <small>Hesablamanı popup və atribut cədvəlində görmək üçün markerə klik edin.</small>
    `;
    container.append(panel);
  }

  window.requestAnimationFrame(() => panel?.classList.add('is-visible'));
}

function hideObstacleExplanation() {
  const panel = document.querySelector('#cesium-map .obstacle-explanation');

  if (!panel) {
    return;
  }

  panel.classList.remove('is-visible');
  window.setTimeout(() => panel.remove(), 180);
}

function showFlightPathExplanation() {
  const container = document.querySelector('#cesium-map');
  let panel = container?.querySelector('.flight-path-explanation');

  if (!panel && container) {
    panel = document.createElement('div');
    panel.className = 'flight-path-explanation';
    panel.innerHTML = `
      <div>
        <span class="tour-kicker">Uçuş Trayektoriyası Demosu</span>
        <strong>Uçuş zolağı hərəkəti və qalxış xətti</strong>
        <small>Təyyarə əvvəl uçuş zolağı üzərində hərəkət edir, sonra 3.0 dərəcə qalxış koridoruna daxil olur.</small>
      </div>
      <div class="flight-path-legend">
        <span><i class="flight-line"></i>Uçuş zolağı hərəkəti və ardından qalxış</span>
        <span><i class="flight-corridor"></i>Şəffaf qorunan qalxış koridoru</span>
        <span><i class="flight-aircraft"></i>Animasiya olunan təyyarə mövqeyi</span>
      </div>
      <small>Bu yalnız vizual təqdimat layer-idir. OLS GeoJSON və yüksəklik dəyərləri dəyişdirilmir.</small>
    `;
    container.append(panel);
  }

  window.requestAnimationFrame(() => panel?.classList.add('is-visible'));
}

function hideFlightPathExplanation() {
  const panel = document.querySelector('#cesium-map .flight-path-explanation');

  if (!panel) {
    return;
  }

  panel.classList.remove('is-visible');
  window.setTimeout(() => panel.remove(), 180);
}

function showNightOperationsExplanation() {
  const container = document.querySelector('#cesium-map');
  let panel = container?.querySelector('.night-ops-explanation');

  if (!panel && container) {
    panel = document.createElement('div');
    panel.className = 'night-ops-explanation';
    panel.innerHTML = `
      <div>
        <span class="tour-kicker">Gecə Əməliyyatları</span>
        <strong>Uçuş zolağı işıqlandırma rejimi</strong>
        <small>Səhnə qaraldılır və yaradılmış uçuş zolağı işıqları gecə hava limanı əməliyyatlarını vurğulayır.</small>
      </div>
      <div class="night-ops-legend">
        <span><i class="night-light white"></i>Uçuş zolağı kənar işıqları</span>
        <span><i class="night-light blue"></i>Mərkəz xətti və yanaşma istiqamət işıqları</span>
        <span><i class="night-light green"></i>Başlanğıc xətti işıqları</span>
      </div>
      <small>Bu yalnız vizual təqdimat rejimidir. GeoJSON mənbə datası dəyişdirilmir.</small>
    `;
    container.append(panel);
  }

  window.requestAnimationFrame(() => panel?.classList.add('is-visible'));
}

function hideNightOperationsExplanation() {
  const panel = document.querySelector('#cesium-map .night-ops-explanation');

  if (!panel) {
    return;
  }

  panel.classList.remove('is-visible');
  window.setTimeout(() => panel.remove(), 180);
}

function showExplodedOlsExplanation() {
  const container = document.querySelector('#cesium-map');
  let panel = container?.querySelector('.ols-explode-explanation');

  if (!panel && container) {
    panel = document.createElement('div');
    panel.className = 'ols-explode-explanation';
    panel.innerHTML = `
      <div>
        <span class="tour-kicker">OLS Ayrılmış Görünüş</span>
        <strong>Ayrılmış təhlükəsizlik səthləri</strong>
        <small>OLS layer-lər yuxarı qaldırılıb ayrılır ki, strukturu və məqsədi daha rahat oxunsun.</small>
      </div>
      <div class="ols-explode-legend">
        <span><i class="explode-stack lower"></i>Aşağı OLS səthləri</span>
        <span><i class="explode-stack upper"></i>Yuxarı ayrılmış səthlər</span>
        <span><i class="explode-stack label"></i>Səth adları layer-ləri izləyir</span>
      </div>
      <small>Bu yalnız təqdimat görünüşüdür. GeoJSON koordinatları və atributları dəyişdirilmir.</small>
    `;
    container.append(panel);
  }

  window.requestAnimationFrame(() => panel?.classList.add('is-visible'));
}

function hideExplodedOlsExplanation() {
  const panel = document.querySelector('#cesium-map .ols-explode-explanation');

  if (!panel) {
    return;
  }

  panel.classList.remove('is-visible');
  window.setTimeout(() => panel.remove(), 180);
}

function updateTourOverlay(overlay, viewpoint) {
  if (!overlay) {
    return;
  }

  overlay.querySelector('[data-tour-title]').textContent = viewpoint.title;
  overlay.querySelector('[data-tour-subtitle]').textContent = viewpoint.subtitle;
}

function removeTourOverlay(overlay) {
  if (!overlay) {
    return;
  }

  overlay.classList.remove('is-visible');
  window.setTimeout(() => overlay.remove(), 180);
}

function wait(duration, tourState) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, tourState.cancelled ? 0 : duration);
  });
}

async function addSatelliteImagery(cesiumViewer) {
  try {
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
      {
        credit: 'Tiles © Esri',
        enablePickFeatures: false,
      },
    );

    cesiumViewer.imageryLayers.addImageryProvider(provider);
  } catch {
    // The bundled NaturalEarthII layer remains visible when external tiles are unavailable.
  }
}

function createCreditContainer(target) {
  const viewerElement = typeof target === 'string' ? document.getElementById(target) : target;
  const mapContainer = viewerElement?.closest('.map-container') ?? viewerElement;
  let creditContainer = mapContainer.querySelector('.cesium-credit-panel');

  if (!creditContainer) {
    creditContainer = document.createElement('div');
    creditContainer.className = 'cesium-credit-panel';
    mapContainer.append(creditContainer);
  }

  return creditContainer;
}

function initializeSelection({ viewer: cesiumViewer, onFeatureSelect }) {
  const popup = createPopup();
  const originalStyles = new WeakMap();
  let selectedEntity = null;

  const handler = new Cesium.ScreenSpaceEventHandler(cesiumViewer.scene.canvas);

  handler.setInputAction((click) => {
    const picked = cesiumViewer.scene.pick(click.position);
    const entity = picked?.id;

    if (selectedEntity) {
      restoreEntityStyle(selectedEntity, originalStyles);
    }

    selectedEntity = isSelectableEntity(entity) ? entity : null;

    if (!selectedEntity) {
      popup.element.hidden = true;
      return;
    }

    highlightEntity(selectedEntity, originalStyles);
    if (identifyModeEnabled) {
      popup.content.innerHTML = createPopupContent(getEntityAttributes(selectedEntity), selectedEntity);
      popup.element.style.left = `${click.position.x + 12}px`;
      popup.element.style.top = `${click.position.y - 12}px`;
      popup.element.hidden = false;
    } else {
      popup.element.hidden = true;
    }

    onFeatureSelect?.(createAttributeAdapter(selectedEntity), {
      get: (key) => (key === 'title' ? selectedEntity.layerTitle : undefined),
    });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function initializeStatusTracking({ viewer: cesiumViewer, onStatusChange }) {
  const handler = new Cesium.ScreenSpaceEventHandler(cesiumViewer.scene.canvas);

  handler.setInputAction((movement) => {
    const cartesian = cesiumViewer.camera.pickEllipsoid(movement.endPosition, cesiumViewer.scene.globe.ellipsoid);

    if (!cartesian) {
      return;
    }

    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    const longitude = Cesium.Math.toDegrees(cartographic.longitude);
    const latitude = Cesium.Math.toDegrees(cartographic.latitude);

    onStatusChange?.({
      lon: longitude.toFixed(6),
      lat: latitude.toFixed(6),
      scale: getCameraScale(cesiumViewer),
      mode: '3D',
    });
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

function getCameraScale(cesiumViewer) {
  const height = cesiumViewer.camera.positionCartographic.height;

  if (!Number.isFinite(height)) {
    return '1:--';
  }

  return `1:${Math.max(1, Math.round(height * 2.2)).toLocaleString('en-US')}`;
}

function createPopup() {
  const container = document.querySelector('#cesium-map');
  const element = document.createElement('div');
  const content = document.createElement('div');

  element.className = 'map-popup cesium-popup';
  element.hidden = true;
  content.className = 'map-popup-content';
  element.append(content);
  container.append(element);

  return { element, content };
}

function isSelectableEntity(entity) {
  return Boolean((entity?.polygon || entity?.point || entity?.billboard) && entity.layerId);
}

function highlightEntity(entity, originalStyles) {
  if (entity.polygon) {
    if (!originalStyles.has(entity)) {
      originalStyles.set(entity, {
        material: entity.polygon.material,
        outlineColor: entity.polygon.outlineColor,
        outlineWidth: entity.polygon.outlineWidth,
      });
    }

    entity.polygon.material = Cesium.Color.YELLOW.withAlpha(0.26);
    entity.polygon.outlineColor = Cesium.Color.YELLOW;
    entity.polygon.outlineWidth = 3;
    return;
  }

  if (entity.point) {
    if (!originalStyles.has(entity)) {
      originalStyles.set(entity, {
        pixelSize: entity.point.pixelSize,
        outlineColor: entity.point.outlineColor,
        outlineWidth: entity.point.outlineWidth,
      });
    }

    entity.point.pixelSize = 18;
    entity.point.outlineColor = Cesium.Color.YELLOW;
    entity.point.outlineWidth = 4;
    return;
  }

  if (entity.billboard) {
    if (!originalStyles.has(entity)) {
      originalStyles.set(entity, {
        scale: entity.billboard.scale,
      });
    }

    entity.billboard.scale = 1.25;
  }
}

function restoreEntityStyle(entity, originalStyles) {
  const originalStyle = originalStyles.get(entity);

  if (!originalStyle) {
    return;
  }

  if (entity.polygon) {
    entity.polygon.material = originalStyle.material;
    entity.polygon.outlineColor = originalStyle.outlineColor;
    entity.polygon.outlineWidth = originalStyle.outlineWidth;
  }

  if (entity.point) {
    entity.point.pixelSize = originalStyle.pixelSize;
    entity.point.outlineColor = originalStyle.outlineColor;
    entity.point.outlineWidth = originalStyle.outlineWidth;
  }

  if (entity.billboard) {
    entity.billboard.scale = originalStyle.scale;
  }
}

function createAttributeAdapter(entity) {
  return {
    getProperties: () => getEntityAttributes(entity),
  };
}

function createPopupContent(attributes, entity = null) {
  const entries = Object.entries(attributes);

  if (entries.length === 0) {
    return '<div class="popup-empty">No attributes</div>';
  }

  const rows = entries
    .map(([key, value]) => `
      <div class="popup-row">
        <span>${escapeHtml(key)}</span>
        <strong>${escapeHtml(formatValue(value))}</strong>
      </div>
    `)
    .join('');

  const title = entity?.layerId === 'obstacles' ? 'Maneə clearance yoxlaması' : 'Obyekt atributları';

  return `<div class="popup-title">${title}</div>${rows}`;
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
