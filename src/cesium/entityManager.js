import * as Cesium from 'cesium';
import { loadGeoJson } from '../data/loader.js';
import { airportLayers } from '../config/airportLayers.js';
import { collectLineStrings, createAirport3DContext, createSurfaceHeightResolver } from './surfaceGeometry.js';
import { runwayPresentation } from '../layers/presentation.js';

export class EntityManager {
  #viewer;
  #dataSources;
  #nightSceneState;
  #olsExplodeState;
  #airport3DContext;

  constructor(viewer) {
    this.#viewer = viewer;
    this.#dataSources = new Map();
    this.#nightSceneState = null;
    this.#olsExplodeState = null;
    this.#airport3DContext = null;
  }

  async loadAirportLayers() {
    const loaded = await Promise.all(airportLayers.map(async (config) => [config, await loadGeoJson(config.path)]));
    const geoJsonById = new Map(loaded.map(([config, geoJson]) => [config.id, geoJson]));
    const context = createAirport3DContext(
      geoJsonById.get('runway'),
      geoJsonById.get('runwayLine'),
      geoJsonById.get('innerHorizontal'),
    );
    this.#airport3DContext = context;

    return Promise.all(loaded.map(async ([config, geoJson]) => {
      const dataSource = this.#createDataSource(config.id, config.title);
      dataSource.show = config.visible;

      if (config.category === 'reference') {
        this.#addReferenceLines(dataSource, geoJson, config, context);
      } else {
        this.#addGeoJsonPolygons(dataSource, geoJson, {
          layerId: config.id,
          layerTitle: config.title,
          material: Cesium.Color.fromCssColorString(config.style3D.fill),
          outlineColor: Cesium.Color.fromCssColorString(config.style3D.stroke),
          outlineWidth: config.category === 'runway' ? 2 : 1,
          heightResolverFactory: (properties, feature) => createSurfaceHeightResolver(config, properties, context, feature.geometry?.coordinates),
        });
      }

      return this.#registerDataSource(config.id, dataSource);
    }));
  }

  async loadDemoObstacles() {
    const existingLayer = this.getLayer('obstacles');

    if (existingLayer) {
      return existingLayer;
    }

    const dataSource = this.#createDataSource('obstacles', 'Maneə Demosu');

    this.#createDemoObstacles().forEach((obstacle) => {
      const color = getObstacleColor(obstacle.status);
      const position = Cesium.Cartesian3.fromDegrees(obstacle.longitude, obstacle.latitude, obstacle.height);
      const groundPosition = Cesium.Cartesian3.fromDegrees(obstacle.longitude, obstacle.latitude, 0);
      const entity = dataSource.entities.add({
        id: `obstacles:${obstacle.id}`,
        name: obstacle.id,
        position,
        properties: new Cesium.PropertyBag({
          ID: obstacle.id,
          STATUS: obstacle.statusLabel,
          RELATED_SURFACE: obstacle.relatedSurface,
          OBSTACLE_HEIGHT_M: obstacle.height,
          OLS_ELEVATION_M: obstacle.surfaceElevation,
          CLEARANCE_M: obstacle.clearance,
          FORMULA: 'Clearance = OLS yüksəkliyi - Maneə hündürlüyü',
          RESULT: obstacle.result,
        }),
        point: {
          pixelSize: 13,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.NONE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${obstacle.id}\n${obstacle.statusLabel}`,
          font: '700 12px Inter, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.72),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        polyline: {
          positions: [groundPosition, position],
          width: 2,
          material: color.withAlpha(0.72),
          clampToGround: false,
        },
      });

      entity.layerId = 'obstacles';
      entity.layerTitle = 'Maneə Demosu';
      entity.obstacleStatus = obstacle.status;
    });

    dataSource.show = true;
    return this.#registerDataSource('obstacles', dataSource);
  }

  async toggleDemoObstacles() {
    return this.setDemoObstaclesVisible(!this.isLayerVisible('obstacles'));
  }

  async setDemoObstaclesVisible(isVisible) {
    const layer = this.getLayer('obstacles') ?? await this.loadDemoObstacles();

    layer.show = isVisible;
    this.#viewer.scene.requestRender();
    return layer.show;
  }

  async loadFlightPathDemo() {
    const existingLayer = this.getLayer('flight-path');

    if (existingLayer) {
      return existingLayer;
    }

    const dataSource = this.#createDataSource('flight-path', 'Uçuş Trayektoriyası Demosu');
    const geometry = this.#createFlightPathGeometry();
    const corridorColor = Cesium.Color.fromCssColorString('#06b6d4');
    const pathColor = Cesium.Color.fromCssColorString('#38bdf8');

    const corridor = dataSource.entities.add({
      id: 'flight-path:corridor',
      name: 'Protected Corridor',
      properties: new Cesium.PropertyBag({
        NAME: 'Protected Corridor',
        TYPE: 'Təqdimat üçün uçuş trayektoriyası vizualizasiyası',
        GLIDE_PATH: `${geometry.glideSlopeDegrees.toFixed(1)} degrees`,
        DEPARTURE_RUNWAY: geometry.departureRunway,
        RELATED_TAKEOFF_SURFACE: geometry.departureLayerId,
        RELATED_APPROACH_SURFACE: geometry.relatedApproachLayer,
        TAKEOFF_SURFACE_SLOPE_PCT: (geometry.takeoffSurfaceSlope * 100).toFixed(1),
        TAKEOFF_ROLL_M: Math.round(geometry.runwayLength),
        CORRIDOR_START_WIDTH_M: geometry.innerWidth,
        CORRIDOR_FINAL_WIDTH_M: geometry.finalWidth,
        CLIMB_LENGTH_M: geometry.climbLength,
        NOTE: 'Flight Path aktiv Take-off və əlaqəli Approach layer atributlarına əsaslanan təqdimat planıdır.',
      }),
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(geometry.corridorCoordinates.flat())),
        perPositionHeight: true,
        material: corridorColor.withAlpha(0.22),
        outline: true,
        outlineColor: corridorColor.withAlpha(0.88),
        outlineWidth: 2,
      },
    });

    corridor.layerId = 'flight-path';
    corridor.layerTitle = 'Uçuş Trayektoriyası Demosu';

    const centerline = dataSource.entities.add({
      id: 'flight-path:centerline',
      name: 'Nominal approach xətti',
      position: geometry.labelPosition,
      properties: new Cesium.PropertyBag({
        NAME: 'Nominal approach xətti',
        FLIGHT_PROFILE: 'Uçuş zolağı hərəkəti və ardından qalxış',
        DEPARTURE_RUNWAY: geometry.departureRunway,
        RELATED_TAKEOFF_SURFACE: geometry.departureLayerId,
        GLIDE_PATH: `${geometry.glideSlopeDegrees.toFixed(1)} degrees`,
        START_HEIGHT_M: geometry.startHeight,
        END_HEIGHT_M: geometry.endHeight,
      }),
      polyline: {
        positions: geometry.pathPositions,
        width: 5,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.22,
          color: pathColor.withAlpha(0.92),
        }),
      },
      label: {
        text: `RWY ${geometry.departureRunway} FLIGHT PLAN\n${geometry.glideSlopeDegrees.toFixed(1)}° nominal climb`,
        font: '700 13px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.68),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        position: geometry.labelPosition,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    centerline.layerId = 'flight-path';
    centerline.layerTitle = 'Uçuş Trayektoriyası Demosu';

    const movingPosition = createMovingFlightPosition(geometry);
    const aircraft = dataSource.entities.add({
      id: 'flight-path:aircraft',
      name: 'Animasiya olunan təyyarə',
      position: movingPosition,
      properties: new Cesium.PropertyBag({
        NAME: 'Animasiya olunan təyyarə',
        PURPOSE: 'Təyyarənin OLS mühiti daxilində qalxmazdan əvvəl runway üzərində hərəkətini göstərir',
        DEPARTURE_RUNWAY: geometry.departureRunway,
        RELATED_TAKEOFF_SURFACE: geometry.departureLayerId,
        GLIDE_PATH: `${geometry.glideSlopeDegrees.toFixed(1)} degrees`,
      }),
      billboard: {
        image: getAircraftIconCanvas(),
        width: 46,
        height: 46,
        rotation: geometry.heading + Cesium.Math.toRadians(300),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: 'TƏYYARƏ',
        font: '800 12px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -26),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    aircraft.layerId = 'flight-path';
    aircraft.layerTitle = 'Uçuş Trayektoriyası Demosu';

    const trail = dataSource.entities.add({
      id: 'flight-path:trail',
      name: 'Təyyarə izi',
      polyline: {
        positions: new Cesium.CallbackProperty(() => createFlightTrailPositions(geometry), false),
        width: 7,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.35,
          color: Cesium.Color.WHITE.withAlpha(0.86),
        }),
      },
    });

    trail.layerId = 'flight-path';
    trail.layerTitle = 'Uçuş Trayektoriyası Demosu';

    dataSource.show = true;
    return this.#registerDataSource('flight-path', dataSource);
  }

  async toggleFlightPathDemo() {
    return this.setFlightPathDemoVisible(!this.isLayerVisible('flight-path'));
  }

  async setFlightPathDemoVisible(isVisible) {
    const layer = this.getLayer('flight-path') ?? await this.loadFlightPathDemo();

    layer.show = isVisible;
    this.#viewer.scene.requestRender();
    return layer.show;
  }

  async loadNightOperations() {
    const existingLayer = this.getLayer('night-ops');

    if (existingLayer) {
      return existingLayer;
    }

    const dataSource = this.#createDataSource('night-ops', 'Gecə Əməliyyatları');
    const runwayStrip = getRunwayStripFromDataSource(this.getLayer('runway'));

    if (runwayStrip) {
      addRunwayLights(dataSource, runwayStrip);
      addApproachLights(dataSource, runwayStrip, this.getRunwayHeading());
    }

    dataSource.show = true;
    return this.#registerDataSource('night-ops', dataSource);
  }

  async toggleNightOperations() {
    return this.setNightOperationsVisible(!this.isLayerVisible('night-ops'));
  }

  async setNightOperationsVisible(isVisible) {
    const layer = this.getLayer('night-ops') ?? await this.loadNightOperations();

    layer.show = isVisible;
    this.#setNightScene(isVisible);
    this.#viewer.scene.requestRender();
    return layer.show;
  }

  async loadConstructionConflictDemo() {
    const existingLayer = this.getLayer('construction-conflict');

    if (existingLayer) {
      return existingLayer;
    }

    const dataSource = this.#createDataSource('construction-conflict', 'Tikinti Konflikti Demosu');
    const geometry = this.#createConstructionConflictGeometry();
    const state = {
      startedAt: Date.now(),
      duration: 8600,
      maxHeight: geometry.maxHeight,
      violationHeight: geometry.violationHeight,
    };

    dataSource.constructionState = state;

    const footprint = dataSource.entities.add({
      id: 'construction-conflict:footprint',
      name: 'Təklif olunan binanın konturu',
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(geometry.footprint.flat())),
        perPositionHeight: true,
        material: Cesium.Color.fromCssColorString('#f97316').withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#f97316').withAlpha(0.92),
        outlineWidth: 2,
      },
    });

    footprint.layerId = 'construction-conflict';
    footprint.layerTitle = 'Tikinti Konflikti Demosu';

    const warningPulse = dataSource.entities.add({
      id: 'construction-conflict:violation-zone',
      name: 'OLS pozuntu zonası',
      position: Cesium.Cartesian3.fromDegrees(geometry.center.longitude, geometry.center.latitude, 2),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => 95 + getConstructionViolationPulse(state) * 36, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => 70 + getConstructionViolationPulse(state) * 26, false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
          const alpha = getConstructionHeight(state) >= state.violationHeight ? 0.16 + getConstructionViolationPulse(state) * 0.18 : 0;
          return Cesium.Color.RED.withAlpha(alpha);
        }, false)),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => (
          getConstructionHeight(state) >= state.violationHeight
            ? Cesium.Color.RED.withAlpha(0.45 + getConstructionViolationPulse(state) * 0.45)
            : Cesium.Color.RED.withAlpha(0)
        ), false),
      },
    });

    warningPulse.layerId = 'construction-conflict';
    warningPulse.layerTitle = 'Tikinti Konflikti Demosu';

    const buildingPosition = new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(
      geometry.center.longitude,
      geometry.center.latitude,
      Math.max(getConstructionHeight(state) / 2, 0.5),
    ), false);
    const building = dataSource.entities.add({
      id: 'construction-conflict:building',
      name: 'Təklif olunan bina',
      position: buildingPosition,
      orientation: Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(geometry.center.longitude, geometry.center.latitude, geometry.maxHeight / 2),
        new Cesium.HeadingPitchRoll(geometry.heading + Cesium.Math.PI_OVER_TWO, 0, 0),
      ),
      properties: new Cesium.PropertyBag({
        NAME: 'Təklif olunan bina',
        STATUS: 'Rədd edildi - OLS pozuntusu',
        PROPOSED_HEIGHT_M: geometry.maxHeight,
        ALLOWED_HEIGHT_M: geometry.violationHeight,
        VIOLATION: `Qorunan səthdən ${Math.round(geometry.maxHeight - geometry.violationHeight)} m yuxarı`,
        NOTE: 'Təqdimat üçün konflikt demosudur. Backend analizi aparılmır.',
      }),
      box: {
        dimensions: new Cesium.CallbackProperty(() => new Cesium.Cartesian3(
          geometry.width,
          geometry.depth,
          Math.max(getConstructionHeight(state), 0.5),
        ), false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => {
          const height = getConstructionHeight(state);

          if (height >= state.violationHeight) {
            return Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.72 + getConstructionViolationPulse(state) * 0.18);
          }

          return Cesium.Color.fromCssColorString('#64748b').withAlpha(0.72);
        }, false)),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(() => (
          getConstructionHeight(state) >= state.violationHeight
            ? Cesium.Color.WHITE.withAlpha(0.95)
            : Cesium.Color.fromCssColorString('#cbd5e1').withAlpha(0.95)
        ), false),
      },
    });

    building.layerId = 'construction-conflict';
    building.layerTitle = 'Tikinti Konflikti Demosu';

    const topLine = dataSource.entities.add({
      id: 'construction-conflict:height-line',
      name: 'Hündürlük pozuntusu markeri',
      polyline: {
        positions: new Cesium.CallbackProperty(() => [
          Cesium.Cartesian3.fromDegrees(geometry.center.longitude, geometry.center.latitude, geometry.violationHeight),
          Cesium.Cartesian3.fromDegrees(geometry.center.longitude, geometry.center.latitude, Math.max(getConstructionHeight(state), geometry.violationHeight)),
        ], false),
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.28,
          color: Cesium.Color.RED.withAlpha(0.9),
        }),
      },
    });

    topLine.layerId = 'construction-conflict';
    topLine.layerTitle = 'Tikinti Konflikti Demosu';

    const label = dataSource.entities.add({
      id: 'construction-conflict:label',
      name: 'Tikinti pozuntusu etiketi',
      position: new Cesium.CallbackProperty(() => Cesium.Cartesian3.fromDegrees(
        geometry.center.longitude,
        geometry.center.latitude,
        Math.max(getConstructionHeight(state), geometry.violationHeight) + 28,
      ), false),
      label: {
        text: new Cesium.CallbackProperty(() => (
          getConstructionHeight(state) >= state.violationHeight
            ? 'OLS POZUNTUSU\nBina qorunan hava məkanına daxil olur'
            : 'TƏKLİF OLUNAN BİNA\nYoxlanılır'
        ), false),
        font: '800 13px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.78),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    label.layerId = 'construction-conflict';
    label.layerTitle = 'Tikinti Konflikti Demosu';

    dataSource.show = false;
    return this.#registerDataSource('construction-conflict', dataSource);
  }

  async setConstructionConflictVisible(isVisible) {
    const layer = this.getLayer('construction-conflict') ?? await this.loadConstructionConflictDemo();

    layer.show = isVisible;
    if (isVisible) {
      layer.constructionState.startedAt = Date.now();
    }
    this.#viewer.scene.requestRender();
    return layer.show;
  }

  toggleOlsExplodedView() {
    return this.setOlsExplodedView(!this.#prepareOlsExplodedView().isExploded);
  }

  setOlsExplodedView(isExploded) {
    const state = this.#prepareOlsExplodedView();

    state.animation = {
      from: state.progress,
      to: isExploded ? 1 : 0,
      startedAt: Date.now(),
      duration: 1200,
    };
    state.isExploded = isExploded;
    state.labelDataSource.show = isExploded;
    this.#viewer.scene.requestRender();

    if (isExploded) {
      const airportSphere = this.getAirportBoundingSphere();

      if (airportSphere) {
        this.#viewer.camera.flyToBoundingSphere(airportSphere, {
          duration: 1.1,
          offset: new Cesium.HeadingPitchRange(
            this.getRunwayHeading() - Cesium.Math.PI_OVER_TWO,
            Cesium.Math.toRadians(-48),
            Math.max(airportSphere.radius * 3.2, 5000),
          ),
        });
      }
    }

    return isExploded;
  }

  setVisible(layerId, visible) {
    const dataSource = this.getLayer(layerId);

    if (dataSource) {
      dataSource.show = visible;
    }
  }

  getLayer(layerId) {
    return this.#dataSources.get(layerId);
  }

  isLayerVisible(layerId) {
    return Boolean(this.getLayer(layerId)?.show);
  }

  getLayerIds() {
    return [...this.#dataSources.keys()];
  }

  async flyToAirport() {
    const airport = this.getLayer('runway') ?? this.getLayerIds().map((layerId) => this.getLayer(layerId)).find(Boolean);

    if (airport) {
      await this.zoomToLayer(airport.layerId);
    }
  }

  async zoomToLayer(layerId) {
    const layer = this.getLayer(layerId);

    if (layer) {
      await this.#viewer.flyTo(layer, {
        duration: 1,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-42), 6500),
      });
    }
  }

  getAirportBoundingSphere() {
    return createBoundingSphere(
      this.getLayerIds().flatMap((layerId) => getDataSourcePositions(this.getLayer(layerId))),
    );
  }

  getLayerBoundingSphere(layerId) {
    return createBoundingSphere(getDataSourcePositions(this.getLayer(layerId)));
  }

  getRunwayHeading() {
    if (this.#airport3DContext?.headingRadians !== undefined) {
      return this.#airport3DContext.headingRadians;
    }

    const referencePositions = getDataSourcePolylines(this.getLayer('runwayLine')).flat();
    const segments = referencePositions.length > 1
      ? getOpenLineSegments(referencePositions)
      : getDataSourceRings(this.getLayer('runway')).flatMap((positions) => getRingSegments(positions));
    const longestPair = segments.reduce((bestSegment, segment) => (
      !bestSegment || segment.distance > bestSegment.distance ? segment : bestSegment
    ), null);

    if (!longestPair) {
      return 0;
    }

    return getBearingRadians(longestPair.first, longestPair.second);
  }

  #createDemoObstacles() {
    const airportSphere = this.getAirportBoundingSphere();
    const center = airportSphere?.center ?? Cesium.Cartesian3.fromDegrees(46.75, 39.09, 0);
    const cartographic = Cesium.Cartographic.fromCartesian(center);
    const origin = {
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
    };
    const heading = this.getRunwayHeading();
    const specs = [
      {
        id: 'OBS-01',
        along: -1200,
        cross: 280,
        height: 24,
        relatedSurface: 'Inner Horizontal',
        surfaceElevation: 45,
      },
      {
        id: 'OBS-02',
        along: 1100,
        cross: -420,
        height: 54,
        relatedSurface: 'Approach',
        surfaceElevation: 60,
      },
      {
        id: 'OBS-03',
        along: 2450,
        cross: 160,
        height: 86,
        relatedSurface: 'Approach',
        surfaceElevation: 60,
      },
      {
        id: 'OBS-04',
        along: 260,
        cross: 1650,
        height: 138,
        relatedSurface: 'Conical',
        surfaceElevation: 145,
      },
    ];

    return specs.map((spec) => {
      const coordinate = offsetCoordinate(origin, spec.along, spec.cross, heading);
      const clearance = Number((spec.surfaceElevation - spec.height).toFixed(1));
      const status = getObstacleStatus(clearance);

      return {
        ...spec,
        ...coordinate,
        clearance,
        status,
        statusLabel: getObstacleStatusLabel(status),
        result: getObstacleResult(status, clearance),
      };
    });
  }

  #createFlightPathGeometry() {
    const context = this.#airport3DContext;
    const departureLayerId = this.isLayerVisible('takeoff03') ? 'takeoff03' : (this.isLayerVisible('takeoff21') ? 'takeoff21' : 'takeoff03');
    const departureRunway = departureLayerId === 'takeoff03' ? '03' : '21';
    const departureProperties = getDataSourceProperties(this.getLayer(departureLayerId));
    const relatedApproachLayer = departureRunway === '03' ? 'approach03' : 'approach21';
    const normalHeading = this.getRunwayHeading();
    const heading = departureRunway === '03' ? normalHeading + Math.PI : normalHeading;
    const runwayStart = departureRunway === '03' ? context.threshold21 : context.threshold03;
    const runwayEnd = departureRunway === '03' ? context.threshold03 : context.threshold21;
    const origin = { longitude: runwayStart[0], latitude: runwayStart[1] };
    const runwayLength = geographicDistance(runwayStart, runwayEnd);
    const totalSurfaceLength = Number(departureProperties.TOTAL_LEN_M) || 15000;
    const climbLength = Math.min(totalSurfaceLength, 9000);
    const length = runwayLength + climbLength;
    const innerWidth = Number(departureProperties.INNER_WIDTH_M) || 180;
    const finalWidth = Number(departureProperties.FINAL_WIDTH_M) || 1200;
    const divergenceLength = Number(departureProperties.DIV_LEN_M) || 4080;
    const corridorWidth = finalWidth;
    const runwayHeight = 5;
    const takeoffSurfaceSlope = (Number(departureProperties.SLOPE_PCT) || 2) / 100;
    const glideSlopeDegrees = Math.max(3, Cesium.Math.toDegrees(Math.atan(takeoffSurfaceSlope)) + 1);
    const climbStartHeight = 12;
    const endHeight = climbStartHeight + Math.tan(Cesium.Math.toRadians(glideSlopeDegrees)) * climbLength;
    const samples = 96;
    const pathPoints = Array.from({ length: samples }, (_, index) => {
      const ratio = index / (samples - 1);
      const along = ratio * length;
      const climbDistance = Math.max(0, along - runwayLength);
      const height = along <= runwayLength
        ? runwayHeight
        : climbStartHeight + Math.tan(Cesium.Math.toRadians(glideSlopeDegrees)) * climbDistance;
      const coordinate = offsetCoordinate(origin, along, 0, heading);

      return {
        ...coordinate,
        height,
        phase: along <= runwayLength ? 'runway-roll' : 'climb',
      };
    });
    const corridorSurfaceHeight = (climbDistance) => climbStartHeight + climbDistance * takeoffSurfaceSlope + 4;
    const divergenceEnd = Math.min(divergenceLength, climbLength);
    const widthAtEnd = innerWidth + (finalWidth - innerWidth) * Math.min(1, climbLength / divergenceLength);
    const corridorCoordinates = [
      createFlightCorridorVertex(origin, runwayLength, -innerWidth / 2, corridorSurfaceHeight(0), heading),
      createFlightCorridorVertex(origin, runwayLength, innerWidth / 2, corridorSurfaceHeight(0), heading),
      createFlightCorridorVertex(origin, runwayLength + divergenceEnd, finalWidth / 2, corridorSurfaceHeight(divergenceEnd), heading),
      createFlightCorridorVertex(origin, runwayLength + climbLength, widthAtEnd / 2, corridorSurfaceHeight(climbLength), heading),
      createFlightCorridorVertex(origin, runwayLength + climbLength, -widthAtEnd / 2, corridorSurfaceHeight(climbLength), heading),
      createFlightCorridorVertex(origin, runwayLength + divergenceEnd, -finalWidth / 2, corridorSurfaceHeight(divergenceEnd), heading),
    ];

    return {
      corridorWidth,
      innerWidth,
      finalWidth,
      divergenceLength,
      departureLayerId,
      departureRunway,
      relatedApproachLayer,
      takeoffSurfaceSlope,
      length,
      runwayLength,
      climbLength,
      startHeight: runwayHeight,
      climbStartHeight,
      endHeight,
      glideSlopeDegrees,
      heading,
      pathPoints,
      pathPositions: pathPoints.map((point) => Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.height)),
      corridorCoordinates,
      labelPosition: Cesium.Cartesian3.fromDegrees(
        pathPoints[Math.floor(pathPoints.length * 0.58)].longitude,
        pathPoints[Math.floor(pathPoints.length * 0.58)].latitude,
        pathPoints[Math.floor(pathPoints.length * 0.58)].height + 95,
      ),
    };
  }

  #createConstructionConflictGeometry() {
    const runwayStrip = getRunwayStripFromDataSource(this.getLayer('runway'));
    const fallbackCenter = this.getAirportBoundingSphere()?.center ?? Cesium.Cartesian3.fromDegrees(46.75, 39.09, 0);
    const fallbackCartographic = Cesium.Cartographic.fromCartesian(fallbackCenter);
    const fallbackOrigin = {
      longitude: Cesium.Math.toDegrees(fallbackCartographic.longitude),
      latitude: Cesium.Math.toDegrees(fallbackCartographic.latitude),
    };
    const heading = this.getRunwayHeading();
    const runwayStart = runwayStrip?.centerLine[0] ?? [fallbackOrigin.longitude, fallbackOrigin.latitude];
    const runwayEnd = runwayStrip?.centerLine[1] ?? [
      offsetCoordinate(fallbackOrigin, 2700, 0, heading).longitude,
      offsetCoordinate(fallbackOrigin, 2700, 0, heading).latitude,
    ];
    const runwayLength = geographicDistance(runwayStart, runwayEnd);
    const origin = { longitude: runwayStart[0], latitude: runwayStart[1] };
    const center = offsetCoordinate(origin, runwayLength * 0.68, 470, heading);
    const width = 92;
    const depth = 68;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const footprint = [
      createConstructionVertex(center, -halfDepth, -halfWidth, heading),
      createConstructionVertex(center, -halfDepth, halfWidth, heading),
      createConstructionVertex(center, halfDepth, halfWidth, heading),
      createConstructionVertex(center, halfDepth, -halfWidth, heading),
    ];

    return {
      center,
      footprint,
      heading,
      width,
      depth,
      violationHeight: 72,
      maxHeight: 132,
    };
  }

  #setNightScene(isEnabled) {
    const scene = this.#viewer.scene;
    const globe = scene.globe;
    const imageryLayers = this.#viewer.imageryLayers;

    if (isEnabled && !this.#nightSceneState) {
      this.#nightSceneState = {
        backgroundColor: scene.backgroundColor?.clone?.() ?? Cesium.Color.BLACK,
        globeEnableLighting: globe.enableLighting,
        fogEnabled: scene.fog.enabled,
        skyAtmosphereShow: scene.skyAtmosphere?.show,
        imagery: Array.from({ length: imageryLayers.length }, (_, index) => {
          const layer = imageryLayers.get(index);

          return {
            layer,
            brightness: layer.brightness,
            contrast: layer.contrast,
            saturation: layer.saturation,
            gamma: layer.gamma,
          };
        }),
      };
    }

    if (isEnabled) {
      scene.backgroundColor = Cesium.Color.fromCssColorString('#050814');
      scene.fog.enabled = true;
      if (scene.skyAtmosphere) {
        scene.skyAtmosphere.show = true;
      }
      globe.enableLighting = true;

      for (let index = 0; index < imageryLayers.length; index += 1) {
        const layer = imageryLayers.get(index);
        layer.brightness = 0.42;
        layer.contrast = 1.18;
        layer.saturation = 0.65;
        layer.gamma = 0.92;
      }

      scene.requestRender();
      return;
    }

    if (!this.#nightSceneState) {
      return;
    }

    scene.backgroundColor = this.#nightSceneState.backgroundColor;
    scene.fog.enabled = this.#nightSceneState.fogEnabled;
    if (scene.skyAtmosphere && this.#nightSceneState.skyAtmosphereShow !== undefined) {
      scene.skyAtmosphere.show = this.#nightSceneState.skyAtmosphereShow;
    }
    globe.enableLighting = this.#nightSceneState.globeEnableLighting;
    this.#nightSceneState.imagery.forEach((settings) => {
      settings.layer.brightness = settings.brightness;
      settings.layer.contrast = settings.contrast;
      settings.layer.saturation = settings.saturation;
      settings.layer.gamma = settings.gamma;
    });
    this.#nightSceneState = null;
    scene.requestRender();
  }

  #prepareOlsExplodedView() {
    if (this.#olsExplodeState) {
      return this.#olsExplodeState;
    }

    const heading = this.getRunwayHeading();
    const entries = this.getLayerIds()
      .filter((layerId) => ['innerHorizontal', 'conical', 'approach03', 'approach21', 'takeoff03', 'takeoff21', 'transitional'].includes(layerId))
      .flatMap((layerId, layerIndex) => {
        const layer = this.getLayer(layerId);
        const layerOffset = getOlsExplodeOffset(layerId, layerIndex, heading);

        return layer.entities.values
          .filter((entity) => entity.polygon)
          .map((entity) => ({
            entity,
            layer,
            layerOffset,
            original: capturePolygonState(entity),
          }));
      });
    const state = {
      entries,
      progress: 0,
      isExploded: false,
      animation: null,
      labelDataSource: this.#createExplodeLabels(entries),
    };

    entries.forEach((entry) => {
      applyExplodedPolygonCallbacks(entry, state);
    });

    this.#olsExplodeState = state;
    return state;
  }

  #createExplodeLabels(entries) {
    const dataSource = this.#createDataSource('ols-explode-labels', 'OLS Exploded View Labels');
    const labelEntries = getExplodeLabelEntries(entries);

    labelEntries.forEach((entry) => {
      const label = dataSource.entities.add({
        id: `ols-explode-label:${entry.layer.layerId}`,
        position: new Cesium.CallbackProperty(() => {
          const progress = getExplodeProgress(this.#olsExplodeState);
          const coordinate = offsetCoordinate(entry.center, entry.offset.forward * progress, 0, entry.offset.heading);

          return Cesium.Cartesian3.fromDegrees(coordinate.longitude, coordinate.latitude, entry.center.height + entry.offset.up * progress + 70);
        }, false),
        label: {
          text: entry.layer.layerTitle,
          font: '800 14px Inter, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.76),
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      label.layerId = 'ols-explode-labels';
      label.layerTitle = 'OLS Exploded View';
    });

    dataSource.show = false;
    this.#registerDataSource('ols-explode-labels', dataSource);
    return dataSource;
  }

  #createDataSource(layerId, title) {
    const dataSource = new Cesium.CustomDataSource(title);
    dataSource.layerId = layerId;
    dataSource.layerTitle = title;
    return dataSource;
  }

  #addRunwayFeatures(dataSource, geoJson) {
    const material = createRunwayAsphaltMaterial();

    (geoJson.features ?? []).forEach((feature, featureIndex) => {
      const properties = feature.properties ?? {};
      const width = Number(properties.WIDTH) || 60;

      getLineStrings(feature.geometry).forEach((lineString, lineIndex) => {
        if (lineString.length < 2) {
          return;
        }

        const strip = createRunwayStrip(lineString, width);

        if (!strip) {
          return;
        }

        const runway = dataSource.entities.add({
          id: `runway:surface:${featureIndex}:${lineIndex}`,
          name: 'Uçuş zolağı səthi',
          properties: new Cesium.PropertyBag({
            ...properties,
            TYPE: 'Uçuş zolağı səthi',
            VISUAL_WIDTH_M: width,
            MATERIAL: 'Prosedural asfalt teksturası',
          }),
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(strip.polygon.flat())),
            perPositionHeight: true,
            material,
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.92),
            outlineWidth: 2,
          },
        });

        runway.layerId = 'runway';
        runway.layerTitle = runwayPresentation.label;

        addRunwayMarkings(dataSource, strip, featureIndex, lineIndex);
      });
    });
  }

  async #registerDataSource(layerId, dataSource) {
    this.#dataSources.set(layerId, dataSource);
    await this.#viewer.dataSources.add(dataSource);
    return dataSource;
  }

  #addGeoJsonPolygons(dataSource, geoJson, options) {
    (geoJson.features ?? []).forEach((feature, featureIndex) => {
      const properties = feature.properties ?? {};
      const polygons = getPolygons(feature.geometry);
      const displayPolygons = polygons;

      displayPolygons.forEach((displayRings, polygonIndex) => {
        const heightResolver = options.heightResolverFactory?.(properties, feature) ?? (() => 0);
        const heightStrategy = { perPositionHeight: true, heightAt: (coordinate) => heightResolver(coordinate) };
        const hierarchy = createPolygonHierarchy(displayRings, heightStrategy);

        if (!hierarchy) {
          return;
        }

        const entity = dataSource.entities.add({
          id: `${options.layerId}:${featureIndex}:${polygonIndex}`,
          name: options.layerTitle,
          properties: new Cesium.PropertyBag(properties),
          polygon: {
            hierarchy,
            height: undefined,
            extrudedHeight: undefined,
            material: options.material,
            outline: true,
            outlineColor: options.outlineColor,
            outlineWidth: options.outlineWidth,
            perPositionHeight: heightStrategy.perPositionHeight,
            closeTop: true,
            closeBottom: true,
          },
        });

        entity.layerId = options.layerId;
        entity.layerTitle = options.layerTitle;

        if (options.layerId !== 'runway' && options.layerId !== 'strip') {
          const edgePositions = removeClosingCoordinate(displayRings[0]).map(([longitude, latitude]) => (
            Cesium.Cartesian3.fromDegrees(longitude, latitude, heightResolver([longitude, latitude]) + 0.8)
          ));
          if (edgePositions.length > 2) edgePositions.push(edgePositions[0]);
          const edge = dataSource.entities.add({
            id: `${options.layerId}:edge:${featureIndex}:${polygonIndex}`,
            name: `${options.layerTitle} boundary`,
            polyline: {
              positions: edgePositions,
              width: 2.4,
              arcType: Cesium.ArcType.NONE,
              material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.16,
                color: options.outlineColor.withAlpha(0.96),
              }),
            },
          });
          edge.layerId = `${options.layerId}:edge`;
          edge.layerTitle = `${options.layerTitle} boundary`;
        }
      });
    });
  }

  #addReferenceLines(dataSource, geoJson, config, context) {
    collectLineStrings(geoJson).filter((line) => line.length > 1).forEach((line, index) => {
      const entity = dataSource.entities.add({
        id: `${config.id}:${index}`,
        name: config.title,
        polyline: {
          positions: line.map((coordinate) => Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], createSurfaceHeightResolver({ id: 'runway' }, {}, context)(coordinate) + 2)),
          width: 2,
          material: Cesium.Color.fromCssColorString(config.style3D.stroke),
        },
      });
      entity.layerId = config.id;
      entity.layerTitle = config.title;
    });
  }
}

function addRunwayMarkings(dataSource, strip, featureIndex, lineIndex) {
  const edgeColor = Cesium.Color.WHITE.withAlpha(0.92);
  const centerColor = Cesium.Color.WHITE.withAlpha(0.86);
  const centerPositions = strip.centerLine.map(([longitude, latitude]) => Cesium.Cartesian3.fromDegrees(longitude, latitude, 2.6));

  const centerline = dataSource.entities.add({
    id: `runway:centerline:${featureIndex}:${lineIndex}`,
    name: 'Uçuş zolağı mərkəz xətti',
    polyline: {
      positions: centerPositions,
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({
        color: centerColor,
        dashLength: 24,
      }),
      clampToGround: false,
    },
  });

  centerline.layerId = 'runway';
  centerline.layerTitle = runwayPresentation.label;

  strip.edges.forEach((edge, edgeIndex) => {
    const edgeLine = dataSource.entities.add({
      id: `runway:edge:${featureIndex}:${lineIndex}:${edgeIndex}`,
      name: 'Uçuş zolağı kənar işarəsi',
      polyline: {
        positions: edge.map(([longitude, latitude]) => Cesium.Cartesian3.fromDegrees(longitude, latitude, 2.8)),
        width: 2,
        material: edgeColor,
        clampToGround: false,
      },
    });

    edgeLine.layerId = 'runway';
    edgeLine.layerTitle = runwayPresentation.label;
  });

  strip.thresholds.forEach((threshold, thresholdIndex) => {
    const thresholdLine = dataSource.entities.add({
      id: `runway:threshold:${featureIndex}:${lineIndex}:${thresholdIndex}`,
      name: 'Uçuş zolağı başlanğıc xətti işarəsi',
      polyline: {
        positions: threshold.map(([longitude, latitude]) => Cesium.Cartesian3.fromDegrees(longitude, latitude, 3)),
        width: 4,
        material: edgeColor,
        clampToGround: false,
      },
    });

    thresholdLine.layerId = 'runway';
    thresholdLine.layerTitle = runwayPresentation.label;
  });
}

function capturePolygonState(entity) {
  const now = Cesium.JulianDate.now();
  const polygon = entity.polygon;
  const hierarchy = polygon.hierarchy.getValue(now);

  return {
    hierarchy: clonePolygonHierarchy(hierarchy),
    height: getPropertyValue(polygon.height, now),
    extrudedHeight: getPropertyValue(polygon.extrudedHeight, now),
    perPositionHeight: getPropertyValue(polygon.perPositionHeight, now),
  };
}

function applyExplodedPolygonCallbacks(entry, state) {
  const polygon = entry.entity.polygon;

  polygon.hierarchy = new Cesium.CallbackProperty(() => {
    const progress = getExplodeProgress(state);
    return shiftPolygonHierarchy(entry.original.hierarchy, entry.layerOffset, progress);
  }, false);

  polygon.height = new Cesium.CallbackProperty(() => {
    if (entry.original.height === undefined || entry.original.perPositionHeight) {
      return undefined;
    }

    return entry.original.height + entry.layerOffset.up * getExplodeProgress(state);
  }, false);

  polygon.extrudedHeight = new Cesium.CallbackProperty(() => {
    if (entry.original.extrudedHeight === undefined) {
      return undefined;
    }

    return entry.original.extrudedHeight + entry.layerOffset.up * getExplodeProgress(state);
  }, false);
}

function getExplodeProgress(state) {
  if (!state.animation) {
    return state.progress;
  }

  const elapsed = Date.now() - state.animation.startedAt;
  const ratio = Math.min(1, elapsed / state.animation.duration);
  const easedRatio = easeInOutCubic(ratio);
  state.progress = state.animation.from + (state.animation.to - state.animation.from) * easedRatio;

  if (ratio >= 1) {
    state.progress = state.animation.to;
    state.animation = null;
  }

  return state.progress;
}

function shiftPolygonHierarchy(hierarchy, offset, progress) {
  return new Cesium.PolygonHierarchy(
    shiftPositions(hierarchy.positions, offset, progress),
    (hierarchy.holes ?? []).map((hole) => shiftPolygonHierarchy(hole, offset, progress)),
  );
}

function shiftPositions(positions, offset, progress) {
  return positions.map((position) => {
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    const origin = {
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
    };
    const coordinate = offsetCoordinate(origin, offset.forward * progress, 0, offset.heading);
    const height = cartographic.height + offset.up * progress;

    return Cesium.Cartesian3.fromDegrees(coordinate.longitude, coordinate.latitude, height);
  });
}

function getOlsExplodeOffset(layerId, layerIndex, heading) {
  const offsets = {
    innerHorizontal: { up: 130, forward: -140 },
    conical: { up: 250, forward: 0 },
    approach03: { up: 370, forward: 520 },
    approach21: { up: 370, forward: -520 },
    takeoff03: { up: 430, forward: 740 },
    takeoff21: { up: 430, forward: -740 },
    transitional: { up: 310, forward: 260 },
  };
  const fallback = { up: 160 + layerIndex * 110, forward: layerIndex * 180 };

  return {
    ...(offsets[layerId] ?? fallback),
    heading,
  };
}

function getExplodeLabelEntries(entries) {
  const byLayer = entries.reduce((groups, entry) => {
    if (!groups.has(entry.layer.layerId)) {
      groups.set(entry.layer.layerId, []);
    }

    groups.get(entry.layer.layerId).push(entry);
    return groups;
  }, new Map());

  return [...byLayer.values()].map((layerEntries) => ({
    layer: layerEntries[0].layer,
    offset: layerEntries[0].layerOffset,
    center: getEntriesCenter(layerEntries),
  }));
}

function getEntriesCenter(entries) {
  const coordinates = entries.flatMap((entry) => entry.original.hierarchy.positions).map((position) => {
    const cartographic = Cesium.Cartographic.fromCartesian(position);

    return {
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
      height: cartographic.height,
    };
  });
  const count = Math.max(coordinates.length, 1);

  return coordinates.reduce((sum, coordinate) => ({
    longitude: sum.longitude + coordinate.longitude / count,
    latitude: sum.latitude + coordinate.latitude / count,
    height: sum.height + coordinate.height / count,
  }), { longitude: 0, latitude: 0, height: 0 });
}

function clonePolygonHierarchy(hierarchy) {
  return new Cesium.PolygonHierarchy(
    [...(hierarchy.positions ?? [])],
    (hierarchy.holes ?? []).map((hole) => clonePolygonHierarchy(hole)),
  );
}

function getPropertyValue(property, time) {
  if (property === undefined || property === null) {
    return undefined;
  }

  return typeof property.getValue === 'function' ? property.getValue(time) : property;
}

function easeInOutCubic(ratio) {
  return ratio < 0.5
    ? 4 * ratio * ratio * ratio
    : 1 - ((-2 * ratio + 2) ** 3) / 2;
}

function easeOutCubic(ratio) {
  return 1 - ((1 - ratio) ** 3);
}

function addRunwayLights(dataSource, strip) {
  const edgeColor = Cesium.Color.fromCssColorString('#f8fafc');
  const centerColor = Cesium.Color.fromCssColorString('#dbeafe');
  const thresholdColor = Cesium.Color.fromCssColorString('#22c55e');

  addLightSeries(dataSource, 'runway-edge-left', strip.edges[0], 120, edgeColor, 8, 'Uçuş zolağı kənar işığı');
  addLightSeries(dataSource, 'runway-edge-right', strip.edges[1], 120, edgeColor, 8, 'Uçuş zolağı kənar işığı');
  addLightSeries(dataSource, 'runway-centerline', strip.centerLine, 170, centerColor, 7, 'Uçuş zolağı mərkəz xətti işığı');
  strip.thresholds.forEach((threshold, index) => {
    addLightSeries(dataSource, `runway-threshold-${index}`, threshold, 16, thresholdColor, 8, 'Uçuş zolağı başlanğıc xətti işığı');
  });
}

function addApproachLights(dataSource, strip, heading) {
  const end = strip.centerLine[1];
  const origin = { longitude: end[0], latitude: end[1] };
  const lightColor = Cesium.Color.fromCssColorString('#93c5fd');
  const positions = Array.from({ length: 14 }, (_, index) => {
    const along = 120 + index * 170;
    const coordinate = offsetCoordinate(origin, along, 0, heading);
    return [coordinate.longitude, coordinate.latitude];
  });

  addLightSeries(dataSource, 'approach-guide', positions, 170, lightColor, 9, 'Yanaşma istiqamət işığı');
}

function addLightSeries(dataSource, idPrefix, coordinates, spacingMeters, color, pixelSize, label) {
  const sampledCoordinates = sampleCoordinateLine(coordinates, spacingMeters);

  sampledCoordinates.forEach((coordinate, index) => {
    const light = dataSource.entities.add({
      id: `night-ops:${idPrefix}:${index}`,
      name: label,
      position: Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], 5.4),
      properties: new Cesium.PropertyBag({
        TYPE: label,
        MODE: 'Gecə əməliyyatları',
        NOTE: 'Uçuş zolağı oxundan yaradılmış təqdimat işıq markeridir',
      }),
      point: {
        pixelSize: new Cesium.CallbackProperty(() => pixelSize + Math.sin(Date.now() / 280 + index) * 1.4, false),
        color: color.withAlpha(0.96),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.95),
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    light.layerId = 'night-ops';
    light.layerTitle = 'Gecə Əməliyyatları';
  });
}

function getRunwayStripFromDataSource(dataSource) {
  const runwaySurface = dataSource?.entities.values.find((entity) => entity.polygon);
  const ring = getEntityPositionRings(runwaySurface)[0];

  if (!ring || ring.length < 4) {
    return null;
  }

  const coordinates = ring.slice(0, 4).map((position) => {
    const cartographic = Cesium.Cartographic.fromCartesian(position);

    return [
      Cesium.Math.toDegrees(cartographic.longitude),
      Cesium.Math.toDegrees(cartographic.latitude),
    ];
  });

  const [leftStart, rightStart, rightEnd, leftEnd] = coordinates;

  return {
    polygon: coordinates.map(([longitude, latitude]) => [longitude, latitude, 1.8]),
    centerLine: [
      midpointCoordinate(leftStart, rightStart),
      midpointCoordinate(leftEnd, rightEnd),
    ],
    edges: [
      [leftStart, leftEnd],
      [rightStart, rightEnd],
    ],
    thresholds: [
      [leftStart, rightStart],
      [leftEnd, rightEnd],
    ],
  };
}

function sampleCoordinateLine(coordinates, spacingMeters) {
  if (coordinates.length < 2) {
    return coordinates;
  }

  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const distance = geographicDistance(start, end);
  const count = Math.max(2, Math.floor(distance / spacingMeters));

  return Array.from({ length: count + 1 }, (_, index) => {
    const ratio = index / count;
    return [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ];
  });
}

function midpointCoordinate(first, second) {
  return [
    (first[0] + second[0]) / 2,
    (first[1] + second[1]) / 2,
  ];
}

function createRunwayStrip(lineString, width) {
  const start = lineString[0];
  const end = lineString[lineString.length - 1];
  const origin = { longitude: start[0], latitude: start[1] };
  const heading = getBearingRadians(
    { longitude: start[0], latitude: start[1] },
    { longitude: end[0], latitude: end[1] },
  );
  const length = geographicDistance(start, end);
  const leftStart = createRunwayVertex(origin, 0, -width / 2, heading);
  const rightStart = createRunwayVertex(origin, 0, width / 2, heading);
  const rightEnd = createRunwayVertex(origin, length, width / 2, heading);
  const leftEnd = createRunwayVertex(origin, length, -width / 2, heading);
  const centerStart = createRunwayVertex(origin, 0, 0, heading);
  const centerEnd = createRunwayVertex(origin, length, 0, heading);

  return {
    polygon: [leftStart, rightStart, rightEnd, leftEnd],
    centerLine: [centerStart.slice(0, 2), centerEnd.slice(0, 2)],
    edges: [
      [leftStart.slice(0, 2), leftEnd.slice(0, 2)],
      [rightStart.slice(0, 2), rightEnd.slice(0, 2)],
    ],
    thresholds: [
      [leftStart.slice(0, 2), rightStart.slice(0, 2)],
      [leftEnd.slice(0, 2), rightEnd.slice(0, 2)],
    ],
  };
}

function createRunwayVertex(origin, alongMeters, crossMeters, heading) {
  const coordinate = offsetCoordinate(origin, alongMeters, crossMeters, heading);

  return [coordinate.longitude, coordinate.latitude, 1.8];
}

function createConstructionVertex(center, alongMeters, crossMeters, heading) {
  const coordinate = offsetCoordinate(center, alongMeters, crossMeters, heading);

  return [coordinate.longitude, coordinate.latitude, 2];
}

function getConstructionHeight(state) {
  const ratio = Math.min(1, Math.max(0, (Date.now() - state.startedAt) / state.duration));

  if (ratio < 0.38) {
    return state.maxHeight * easeOutCubic(ratio / 0.38);
  }

  if (ratio < 0.68) {
    return state.maxHeight;
  }

  return state.maxHeight * (1 - easeInOutCubic((ratio - 0.68) / 0.32));
}

function getConstructionViolationPulse(state) {
  if (getConstructionHeight(state) < state.violationHeight) {
    return 0;
  }

  return (Math.sin(Date.now() / 120) + 1) / 2;
}

function createRunwayAsphaltMaterial() {
  return new Cesium.ImageMaterialProperty({
    image: getRunwayTextureCanvas(),
    repeat: new Cesium.Cartesian2(10, 1),
    color: Cesium.Color.WHITE,
  });
}

function getRunwayTextureCanvas() {
  const canvas = document.createElement('canvas');
  const width = 512;
  const height = 128;
  const context = canvas.getContext('2d');

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#242a31';
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < 900; index += 1) {
    const shade = 34 + Math.floor(Math.random() * 30);
    context.fillStyle = `rgba(${shade}, ${shade + 2}, ${shade + 6}, ${0.24 + Math.random() * 0.24})`;
    context.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  context.strokeStyle = 'rgba(255,255,255,0.72)';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(0, 10);
  context.lineTo(width, 10);
  context.moveTo(0, height - 10);
  context.lineTo(width, height - 10);
  context.stroke();

  context.strokeStyle = 'rgba(255,255,255,0.86)';
  context.lineWidth = 3;
  context.setLineDash([34, 26]);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  context.setLineDash([]);
  context.fillStyle = 'rgba(255,255,255,0.8)';
  for (let x = 18; x < 90; x += 14) {
    context.fillRect(x, 28, 6, 72);
    context.fillRect(width - x - 6, 28, 6, 72);
  }

  return canvas;
}

function getAircraftIconCanvas() {
  const canvas = document.createElement('canvas');
  const size = 96;
  const context = canvas.getContext('2d');

  canvas.width = size;
  canvas.height = size;
  context.translate(size / 2, size / 2);
  context.shadowColor = 'rgba(6, 182, 212, 0.95)';
  context.shadowBlur = 16;
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#0891b2';
  context.lineWidth = 3;
  context.lineJoin = 'round';

  context.beginPath();
  context.moveTo(0, -38);
  context.lineTo(9, -8);
  context.lineTo(35, 4);
  context.lineTo(35, 14);
  context.lineTo(8, 9);
  context.lineTo(6, 31);
  context.lineTo(18, 40);
  context.lineTo(18, 47);
  context.lineTo(0, 39);
  context.lineTo(-18, 47);
  context.lineTo(-18, 40);
  context.lineTo(-6, 31);
  context.lineTo(-8, 9);
  context.lineTo(-35, 14);
  context.lineTo(-35, 4);
  context.lineTo(-9, -8);
  context.closePath();
  context.fill();
  context.stroke();

  context.shadowBlur = 0;
  context.fillStyle = '#06b6d4';
  context.beginPath();
  context.ellipse(0, -15, 4, 12, 0, 0, Math.PI * 2);
  context.fill();

  return canvas;
}

function getLineStrings(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'LineString') {
    return [geometry.coordinates];
  }

  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates;
  }

  return [];
}

function getDataSourcePositions(dataSource) {
  if (!dataSource) {
    return [];
  }

  return dataSource.entities.values.flatMap((entity) => getEntityPositions(entity));
}

function getDataSourceRings(dataSource) {
  if (!dataSource) {
    return [];
  }

  return dataSource.entities.values.flatMap((entity) => getEntityPositionRings(entity));
}

function getDataSourceProperties(dataSource) {
  const entity = dataSource?.entities.values.find((candidate) => candidate.properties);
  return entity?.properties?.getValue(Cesium.JulianDate.now()) ?? {};
}

function getDataSourcePolylines(dataSource) {
  if (!dataSource) {
    return [];
  }

  return dataSource.entities.values
    .map((entity) => entity.polyline?.positions?.getValue?.(Cesium.JulianDate.now()) ?? [])
    .filter((positions) => positions.length > 1);
}

function getRunwayReferenceLine(dataSource, targetLength) {
  const result = getDataSourcePolylines(dataSource).reduce((best, positions) => {
    const coordinates = positions.map(cartesianToCoordinate);
    const length = geographicDistance(coordinates[0], coordinates[coordinates.length - 1]);
    const difference = Math.abs(length - targetLength);
    return !best || difference < best.difference ? { coordinates, length, difference } : best;
  }, null);
  return result?.coordinates ?? null;
}

function orientReferenceLine(line, expectedHeading) {
  if (!line || line.length < 2) return line;
  const first = { longitude: line[0][0], latitude: line[0][1] };
  const last = { longitude: line[line.length - 1][0], latitude: line[line.length - 1][1] };
  const actualHeading = getBearingRadians(first, last);
  const difference = Math.abs(Math.atan2(Math.sin(actualHeading - expectedHeading), Math.cos(actualHeading - expectedHeading)));
  return difference > Cesium.Math.PI_OVER_TWO ? [...line].reverse() : line;
}

function getOpenLineSegments(positions) {
  return positions.slice(0, -1).map((first, index) => {
    const second = positions[index + 1];
    const firstCoordinate = cartesianToCoordinate(first);
    const secondCoordinate = cartesianToCoordinate(second);
    return {
      first: { longitude: firstCoordinate[0], latitude: firstCoordinate[1] },
      second: { longitude: secondCoordinate[0], latitude: secondCoordinate[1] },
      distance: geographicDistance(firstCoordinate, secondCoordinate),
    };
  });
}

function cartesianToCoordinate(position) {
  const cartographic = Cesium.Cartographic.fromCartesian(position);
  return [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude)];
}

function getEntityPositions(entity) {
  const pointPosition = getPointPosition(entity);

  return [
    ...getEntityPositionRings(entity).flat(),
    ...(pointPosition ? [pointPosition] : []),
  ];
}

function getEntityPositionRings(entity) {
  if (!entity) {
    return [];
  }

  const hierarchy = entity.polygon?.hierarchy?.getValue(Cesium.JulianDate.now());

  if (!hierarchy) {
    return [];
  }

  return [
    hierarchy.positions ?? [],
    ...(hierarchy.holes ?? []).map((hole) => hole.positions ?? []),
  ];
}

function getPointPosition(entity) {
  return entity.position?.getValue(Cesium.JulianDate.now()) ?? null;
}

function createBoundingSphere(positions) {
  if (!positions.length) {
    return null;
  }

  return Cesium.BoundingSphere.fromPoints(positions);
}

function getRingSegments(positions) {
  const points = positions.map((position) => {
    const cartographic = Cesium.Cartographic.fromCartesian(position);

    return {
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
    };
  });

  return points.map((first, index) => {
    const second = points[(index + 1) % points.length];

    return {
      first,
      second,
      distance: Math.hypot(second.longitude - first.longitude, second.latitude - first.latitude),
    };
  });
}

function getBearingRadians(first, second) {
  const firstLatitude = Cesium.Math.toRadians(first.latitude);
  const secondLatitude = Cesium.Math.toRadians(second.latitude);
  const longitudeDelta = Cesium.Math.toRadians(second.longitude - first.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(secondLatitude);
  const x = Math.cos(firstLatitude) * Math.sin(secondLatitude)
    - Math.sin(firstLatitude) * Math.cos(secondLatitude) * Math.cos(longitudeDelta);

  return Math.atan2(y, x);
}

function offsetCoordinate(origin, alongMeters, crossMeters, heading) {
  const eastMeters = Math.sin(heading) * alongMeters + Math.sin(heading + Cesium.Math.PI_OVER_TWO) * crossMeters;
  const northMeters = Math.cos(heading) * alongMeters + Math.cos(heading + Cesium.Math.PI_OVER_TWO) * crossMeters;
  const metersPerDegreeLatitude = 110540;
  const metersPerDegreeLongitude = 111320 * Math.cos(Cesium.Math.toRadians(origin.latitude));

  return {
    longitude: origin.longitude + eastMeters / metersPerDegreeLongitude,
    latitude: origin.latitude + northMeters / metersPerDegreeLatitude,
  };
}

function createFlightCorridorVertex(origin, alongMeters, crossMeters, height, heading) {
  const coordinate = offsetCoordinate(origin, alongMeters, crossMeters, heading);

  return [coordinate.longitude, coordinate.latitude, height];
}

function createMovingFlightPosition(geometry) {
  return new Cesium.CallbackProperty(() => {
    const point = interpolateFlightPoint(geometry, getFlightAnimationRatio());

    return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.height);
  }, false);
}

function createFlightTrailPositions(geometry) {
  const ratio = getFlightAnimationRatio();
  const trailLength = 0.18;
  const trailSamples = 18;

  return Array.from({ length: trailSamples }, (_, index) => {
    const localRatio = index / (trailSamples - 1);
    const sampleRatio = Math.max(0, ratio - trailLength + localRatio * trailLength);
    const point = interpolateFlightPoint(geometry, sampleRatio);

    return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.height);
  });
}

function interpolateFlightPoint(geometry, ratio) {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const scaledIndex = clampedRatio * (geometry.pathPoints.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(geometry.pathPoints.length - 1, lowerIndex + 1);
  const localRatio = scaledIndex - lowerIndex;
  const start = geometry.pathPoints[lowerIndex];
  const end = geometry.pathPoints[upperIndex];
  const interpolate = (first, second) => first + (second - first) * localRatio;

  return {
    longitude: interpolate(start.longitude, end.longitude),
    latitude: interpolate(start.latitude, end.latitude),
    height: interpolate(start.height, end.height),
  };
}

function getFlightAnimationRatio() {
  const durationMs = 7200;

  return (Date.now() % durationMs) / durationMs;
}

function getObstacleStatus(clearance) {
  if (clearance < 0) {
    return 'penetration';
  }

  if (clearance <= 10) {
    return 'warning';
  }

  return 'safe';
}

function getObstacleStatusLabel(status) {
  const labels = {
    safe: 'Təhlükəsiz',
    warning: 'OLS-ə yaxın',
    penetration: 'OLS pozuntusu',
  };

  return labels[status] ?? 'Naməlum';
}

function getObstacleResult(status, clearance) {
  if (status === 'penetration') {
    return `İcazə verilən OLS səthindən ${Math.abs(clearance)} m yuxarıdır`;
  }

  if (status === 'warning') {
    return `${clearance} m clearance - OLS-ə yaxındır`;
  }

  return `${clearance} m clearance`;
}

function getObstacleColor(status) {
  const colors = {
    safe: Cesium.Color.fromCssColorString('#22c55e'),
    warning: Cesium.Color.fromCssColorString('#f59e0b'),
    penetration: Cesium.Color.fromCssColorString('#ef4444'),
  };

  return colors[status] ?? Cesium.Color.WHITE;
}

export function getEntityAttributes(entity) {
  if (!entity?.properties) {
    return {};
  }

  return entity.properties.getValue(Cesium.JulianDate.now()) ?? {};
}

function getPolygons(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Polygon') {
    return [geometry.coordinates];
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates;
  }

  return [];
}

function createPolygonHierarchy(rings, heightStrategy = null) {
  const outerRing = rings?.[0];

  if (!outerRing || outerRing.length < 3) {
    return null;
  }

  const positions = coordinatesToCartesian(outerRing, heightStrategy);
  const holes = rings
    .slice(1)
    .filter((ring) => ring.length >= 3)
    .map((ring) => new Cesium.PolygonHierarchy(coordinatesToCartesian(ring, heightStrategy)));

  return new Cesium.PolygonHierarchy(positions, holes);
}

function coordinatesToCartesian(coordinates, heightStrategy = null) {
  const openCoordinates = removeClosingCoordinate(coordinates);

  return openCoordinates.map(([longitude, latitude], index) => {
    const height = getVertexHeight(index, openCoordinates, heightStrategy);
    return Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
  });
}

function getVertexHeight(index, coordinates, heightStrategy) {
  if (!heightStrategy?.perPositionHeight) {
    return undefined;
  }

  return heightStrategy.heightAt?.(coordinates[index]) ?? heightStrategy.startElevation;
}

function getFeatureElevation(properties, options) {
  if (!options.useOlsHeights) {
    return {
      startElevation: options.height ?? 0,
      endElevation: options.height ?? 0,
      isFlat: true,
      volumeBaseElevation: undefined,
    };
  }

  const elevation = resolveOlsElevations(properties);

  return elevation;
}

function getHeightStrategy(rings, elevation, options) {
  if (!options.useOlsHeights || elevation.isFlat) {
    return {
      perPositionHeight: false,
      startElevation: elevation.startElevation,
      endElevation: elevation.endElevation,
      volumeBaseElevation: elevation.volumeBaseElevation,
    };
  }

  if (options.isApproach) {
    return {
      type: 'approach',
      perPositionHeight: true,
      startElevation: elevation.startElevation,
      endElevation: elevation.endElevation,
      volumeBaseElevation: elevation.volumeBaseElevation,
    };
  }

  if (options.maxPolygonArea > options.minPolygonArea) {
    const ratio = (options.polygonArea - options.minPolygonArea) / (options.maxPolygonArea - options.minPolygonArea);
    const height = elevation.startElevation + (elevation.endElevation - elevation.startElevation) * ratio;

    return {
      type: 'constant',
      perPositionHeight: true,
      startElevation: height,
      endElevation: height,
      volumeBaseElevation: elevation.volumeBaseElevation,
    };
  }

  const gradient = createGradientStrategy(rings[0], elevation);

  return gradient ?? {
    perPositionHeight: false,
    startElevation: elevation.startElevation,
    endElevation: elevation.endElevation,
    volumeBaseElevation: elevation.volumeBaseElevation,
  };
}

function createGradientStrategy(ring, elevation) {
  const coordinates = removeClosingCoordinate(ring);

  if (coordinates.length < 3) {
    return null;
  }

  const center = coordinates.reduce(
    (sum, [longitude, latitude]) => [sum[0] + longitude / coordinates.length, sum[1] + latitude / coordinates.length],
    [0, 0],
  );
  const distances = coordinates.map((coordinate) => geographicDistance(center, coordinate));
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);

  if (Math.abs(maxDistance - minDistance) < 0.001) {
    return {
      type: 'constant',
      perPositionHeight: true,
      startElevation: elevation.endElevation,
      endElevation: elevation.endElevation,
      volumeBaseElevation: elevation.volumeBaseElevation,
    };
  }

  return {
    type: 'gradient',
    perPositionHeight: true,
    center,
    minDistance,
    maxDistance,
    startElevation: elevation.startElevation,
    endElevation: elevation.endElevation,
    volumeBaseElevation: elevation.volumeBaseElevation,
  };
}

function interpolateHeight(coordinate, strategy) {
  const distanceFromCenter = geographicDistance(strategy.center, coordinate);
  const ratio = Math.min(1, Math.max(0, (distanceFromCenter - strategy.minDistance) / (strategy.maxDistance - strategy.minDistance)));

  return strategy.startElevation + (strategy.endElevation - strategy.startElevation) * ratio;
}

function geographicDistance(first, second) {
  const latitude = ((first[1] + second[1]) / 2 * Math.PI) / 180;
  const metersPerDegreeLongitude = 111320 * Math.cos(latitude);
  const metersPerDegreeLatitude = 110540;
  const dx = (second[0] - first[0]) * metersPerDegreeLongitude;
  const dy = (second[1] - first[1]) * metersPerDegreeLatitude;

  return Math.hypot(dx, dy);
}

function getRingArea(ring) {
  const coordinates = removeClosingCoordinate(ring);

  return coordinates.reduce((area, coordinate, index) => {
    const nextCoordinate = coordinates[(index + 1) % coordinates.length];
    return area + coordinate[0] * nextCoordinate[1] - nextCoordinate[0] * coordinate[1];
  }, 0) / 2;
}

function removeClosingCoordinate(coordinates) {
  const lastIndex = coordinates.length - 1;

  if (lastIndex > 0 && coordinates[0][0] === coordinates[lastIndex][0] && coordinates[0][1] === coordinates[lastIndex][1]) {
    return coordinates.slice(0, lastIndex);
  }

  return coordinates;
}

function compareOstIds(first, second) {
  const firstNumber = Number(first);
  const secondNumber = Number(second);

  if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
    return firstNumber - secondNumber;
  }

  return first.localeCompare(second, undefined, { numeric: true });
}
