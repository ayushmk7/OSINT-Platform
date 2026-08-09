import { useEffect, useRef, type FC } from 'react';
import { Box } from '@mui/material';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useAppDispatch, useAppSelector } from '../store';
import { setSelectedEntityId } from '../store/slices/entitiesSlice';
import { markerForCategory, bearingRad, isEntityVisible } from './globeMarkers';

// Real dark slippy-map basemap — NO API key required. Built by a factory because React
// StrictMode double-invokes effects in dev. (Optional upgrade: set VITE_CESIUM_ION_TOKEN and
// switch to Cesium Ion World Imagery instead.)
function makeBaseLayer(): Cesium.ImageryLayer {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png',
      maximumLevel: 18,
      credit: 'Stadia Maps, OpenMapTiles, OpenStreetMap'
    })
  );
}

// Gentle idle rotation, in radians per clock tick (~60fps). Stops on first interaction.
const SPIN_PER_TICK = 0.0015;

// Markers are drawn on a 2x (64px) canvas, so 0.5 displays them at their true 32px size.
const MARKER_BASE_SCALE = 0.5;
const SELECTED_SCALE_BOOST = 1.5;

export const GlobeView: FC = () => {
  const dispatch = useAppDispatch();
  const entities = useAppSelector((s) => s.entities.entities);
  const activeCategory = useAppSelector((s) => s.entities.activeCategoryFilter);
  const enabledSources = useAppSelector((s) => s.sources.enabledSourceIds);
  // "Has the source list arrived yet?" — NOT "are any sources enabled?". Before `initial_state`
  // lands both lists are empty and everything must still draw; once the list is known, an
  // unchecked source must hide its entities, including when the user unchecks every one.
  const sourcesLoaded = useAppSelector((s) => Object.keys(s.sources.sources).length > 0);
  const selectedId = useAppSelector((s) => s.entities.selectedEntityId);
  const lodEnabled = useAppSelector((s) => s.filter.lodEnabled);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const billboardsRef = useRef<Cesium.BillboardCollection | null>(null);
  const byId = useRef<Map<string, Cesium.Billboard>>(new Map());

  // Mount once: create the viewer, the billboard layer, and the click handler.
  useEffect(() => {
    if (!containerRef.current) return;
    let viewer: Cesium.Viewer;
    try {
      viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer: makeBaseLayer(),
        baseLayerPicker: false,
        timeline: false,
        animation: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        requestRenderMode: true,
        maximumRenderTimeChange: 0.5,
        scene3DOnly: true,
        shouldAnimate: true,
        shadows: false
      });
    } catch (err) {
      console.error('Cesium viewer failed to initialize:', err); // never swallow silently
      return;
    }

    viewer.scene.backgroundColor = Cesium.Color.BLACK;
    (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';

    // One BillboardCollection for every entity marker — far cheaper than an Entity per target.
    const billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
    billboardsRef.current = billboards;
    viewerRef.current = viewer;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked: unknown = viewer.scene.pick(movement.position);
      const pickedId = (picked as { id?: unknown } | undefined)?.id;
      if (typeof pickedId === 'string') {
        dispatch(setSelectedEntityId(pickedId)); // billboard.id holds the entity id
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Idle "attract mode": spin slowly until the user grabs the globe, then stop so panning and
    // zoom feel natural. camera.rotate marks the scene dirty each tick, so it still renders
    // under requestRenderMode. LEFT_DOWN fires before LEFT_CLICK, so clicking a marker both
    // stops the spin AND selects the entity.
    let spinning = true;
    const onTick = () => {
      if (spinning) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN_PER_TICK);
    };
    viewer.clock.onTick.addEventListener(onTick);

    const stopSpin = () => {
      spinning = false;
    };
    handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.WHEEL);

    return () => {
      viewer.clock.onTick.removeEventListener(onTick);
      handler.destroy();
      byId.current.clear();
      billboardsRef.current = null;
      viewerRef.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
    };
  }, [dispatch]);

  // Level-of-detail toggle (step 5): render at 60% resolution and accept a coarser terrain/imagery
  // screen-space error, which is what buys back frame rate on low-end GPUs.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.resolutionScale = lodEnabled ? 0.6 : 1.0;
    viewer.scene.globe.maximumScreenSpaceError = lodEnabled ? 8 : 2;
    viewer.scene.requestRender();
  }, [lodEnabled]);

  // Upsert billboards whenever entities / filters / selection change.
  useEffect(() => {
    const viewer = viewerRef.current;
    const billboards = billboardsRef.current;
    if (!viewer || !billboards || viewer.isDestroyed()) return;
    const map = byId.current;
    const visibleIds = new Set<string>();

    for (const entity of Object.values(entities)) {
      if (!isEntityVisible(entity, activeCategory, enabledSources, sourcesLoaded)) continue;
      visibleIds.add(entity.id);

      const position = Cesium.Cartesian3.fromDegrees(
        entity.longitude,
        entity.latitude,
        entity.altitude || 0
      );
      let bb = map.get(entity.id);
      if (!bb) {
        bb = billboards.add({
          id: entity.id,
          position,
          image: markerForCategory(entity.category),
          color: Cesium.Color.WHITE, // color is baked into the PNG pixels
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        });
        map.set(entity.id, bb);
      } else {
        bb.position = position;
        bb.show = true;
      }
      bb.scale = (entity.id === selectedId ? SELECTED_SCALE_BOOST : 1.0) * MARKER_BASE_SCALE;

      // Aircraft & ships: rotate to travel heading derived from the last two trail points.
      // (Both silhouettes point north, so the same rotation applies.)
      if (
        (entity.category === 'aircraft' || entity.category === 'maritime') &&
        entity.trail &&
        entity.trail.length >= 2
      ) {
        const a = entity.trail[entity.trail.length - 2];
        const b = entity.trail[entity.trail.length - 1];
        bb.rotation = -bearingRad(a.latitude, a.longitude, b.latitude, b.longitude);
        bb.alignedAxis = Cesium.Cartesian3.UNIT_Z;
      }
    }

    for (const [id, bb] of map) {
      if (!visibleIds.has(id)) bb.show = false;
    }
    viewer.scene.requestRender();
  }, [entities, activeCategory, enabledSources, sourcesLoaded, selectedId]);

  return (
    <Box
      ref={containerRef}
      data-testid="globe-view-container"
      // z-index 0 = the bottom of the step-5 layer contract (overlays 10 < HUD 20 < drawers).
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        width: '100%',
        height: '100%',
        bgcolor: '#000'
      }}
    />
  );
};
