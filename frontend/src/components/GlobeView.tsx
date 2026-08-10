import { useEffect, useRef, type FC } from 'react';
import { Box } from '@mui/material';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useAppDispatch, useAppSelector } from '../store';
import {
  setSelectedEntityId,
  parseEntityMetadata,
  type EntityRecord
} from '../store/slices/entitiesSlice';
import {
  markerForCategory,
  bearingRad,
  isEntityVisible,
  colorForCategory,
  zoneRadiusMeters,
  ATC_ZONE_CATEGORY
} from './globeMarkers';
import { GlobeStyleController } from './globeStyles';

// Gentle idle rotation, in radians per clock tick (~60fps). Stops on first interaction.
const SPIN_PER_TICK = 0.0015;

// Markers are drawn on a 2x (64px) canvas, so 0.5 displays them at their true 32px size.
const MARKER_BASE_SCALE = 0.5;
const SELECTED_SCALE_BOOST = 1.5;

// ATC control zones are real ground geometry, not billboards: a 5–9 km circle has to grow and
// shrink with the camera exactly like the terrain under it, which a screen-space billboard
// cannot do. They live in `viewer.entities` (Cesium's Entity API) ALONGSIDE the
// BillboardCollection, in this same viewer — the tower billboard still marks the centre.
const ZONE_FILL_ALPHA = 0.18;
const ZONE_SELECTED_FILL_ALPHA = 0.38;
const ZONE_OUTLINE_ALPHA = 0.95;

/** Zone tint: the same violet as the atc_zone marker + layer swatch, so the legend reads true. */
function zoneColor(alpha: number): Cesium.Color {
  return Cesium.Color.fromCssColorString(colorForCategory(ATC_ZONE_CATEGORY)).withAlpha(alpha);
}

/**
 * Create/update the control-zone circle for one ATC entity.
 *
 * `height: 0` (rather than a ground-clamped ellipse) is deliberate: a classification-clamped
 * ellipse cannot draw an outline, and the outline is what makes a 5 km circle legible against
 * the dark basemap. The Cesium Entity's own `id` is the entity id, so a click on the shape
 * picks exactly what a click on the billboard does.
 */
function upsertZone(
  viewer: Cesium.Viewer,
  zones: Map<string, Cesium.Entity>,
  entity: EntityRecord,
  isSelected: boolean
): void {
  const radius = zoneRadiusMeters(parseEntityMetadata(entity.metadata).radius_km);
  const position = Cesium.Cartesian3.fromDegrees(entity.longitude, entity.latitude, 0);
  const fill = zoneColor(isSelected ? ZONE_SELECTED_FILL_ALPHA : ZONE_FILL_ALPHA);

  let zone = zones.get(entity.id);
  if (!zone) {
    zone = viewer.entities.add({
      id: entity.id,
      position,
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        height: 0,
        material: new Cesium.ColorMaterialProperty(fill),
        outline: true,
        outlineColor: zoneColor(ZONE_OUTLINE_ALPHA),
        outlineWidth: 2
      }
    });
    zones.set(entity.id, zone);
    return;
  }

  zone.position = new Cesium.ConstantPositionProperty(position);
  zone.show = true;
  if (zone.ellipse) {
    zone.ellipse.material = new Cesium.ColorMaterialProperty(fill);
    zone.ellipse.semiMajorAxis = new Cesium.ConstantProperty(radius);
    zone.ellipse.semiMinorAxis = new Cesium.ConstantProperty(radius);
  }
}

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
  const globeStyle = useAppSelector((s) => s.filter.globeStyle);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const billboardsRef = useRef<Cesium.BillboardCollection | null>(null);
  const byId = useRef<Map<string, Cesium.Billboard>>(new Map());
  const zonesById = useRef<Map<string, Cesium.Entity>>(new Map());
  const globeStyleRef = useRef<GlobeStyleController | null>(null);

  // Mount once: create the viewer, the billboard layer, and the click handler.
  useEffect(() => {
    if (!containerRef.current) return;
    let viewer: Cesium.Viewer;
    try {
      viewer = new Cesium.Viewer(containerRef.current, {
        // No boot imagery: the globe-style effect below owns every imagery layer, and it runs
        // before the first paint. (`imageryProvider: false` is dead in Cesium 1.144 — the
        // supported spelling is `baseLayer: false`.)
        baseLayer: false,
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

    // Owns the globe's base look. Constructed here so it can snapshot Cesium's pristine defaults
    // off a freshly built viewer; the style effect below applies the selected look.
    globeStyleRef.current = new GlobeStyleController(viewer);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked: unknown = viewer.scene.pick(movement.position);
      const pickedId = (picked as { id?: unknown } | undefined)?.id;
      // A billboard pick hands back `billboard.id` (the entity id string); an ATC zone ellipse
      // hands back the Cesium Entity itself, whose own `.id` is that same string. Either way the
      // click selects the entity and opens the inspector.
      const entityId =
        typeof pickedId === 'string'
          ? pickedId
          : pickedId instanceof Cesium.Entity && typeof pickedId.id === 'string'
            ? pickedId.id
            : null;
      if (entityId) dispatch(setSelectedEntityId(entityId));
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
      zonesById.current.clear(); // the Entities die with the viewer; drop the stale handles too
      globeStyleRef.current?.destroy();
      globeStyleRef.current = null;
      billboardsRef.current = null;
      viewerRef.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
    };
  }, [dispatch]);

  // Globe base look. Runs on mount (so the viewer never paints a bare sphere) and on every
  // switch. The controller swaps ONLY the imagery layers / style overlays it owns — the marker
  // BillboardCollection, the ATC-zone Entities, the camera and the WebSocket feed are all
  // untouched, which is why a style change cannot wipe live tracks.
  useEffect(() => {
    const viewer = viewerRef.current;
    const controller = globeStyleRef.current;
    if (!viewer || !controller || viewer.isDestroyed()) return;
    void controller.apply(globeStyle);
  }, [globeStyle]);

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

      // ATC facilities additionally get their control-zone circle drawn on the globe.
      if (entity.category === ATC_ZONE_CATEGORY) {
        upsertZone(viewer, zonesById.current, entity, entity.id === selectedId);
      }

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
    // Zones follow the same layer/source filters as their marker — hide, never remove, so a
    // re-enabled layer costs nothing to bring back.
    for (const [id, zone] of zonesById.current) {
      if (!visibleIds.has(id)) zone.show = false;
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
