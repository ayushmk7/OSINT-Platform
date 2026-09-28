import { useEffect, useRef, type FC } from 'react';
import { Box } from '@mui/material';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useAppDispatch, useAppSelector } from '../store';
import {
  setSelectedEntityId,
  setTrailLimits,
  parseEntityMetadata,
  type EntityRecord
} from '../store/slices/entitiesSlice';
import {
  markerForCategory,
  markerForIcon,
  isEntityVisible,
  colorForCategory,
  zoneRadiusMeters,
  renderHeight,
  selectionRingMarker,
  ATC_ZONE_CATEGORY
} from './globeMarkers';
import { GlobeStyleController } from './globeStyles';
import { entityHeadingRad, entityLayerId, isExpired, resolveEntityStyle } from './layerStyle';
import { useTtlPruner } from '../hooks/useTtlPruner';
import { TrailLayer, trailLimitsFromSources } from './trails';

// Gentle idle rotation, in radians per clock tick (~60fps). Stops on first interaction.
const SPIN_PER_TICK = 0.0015;

// Markers are drawn on a 2x (64px) canvas, so 0.5 displays them at their true 32px size.
// That is the close-up size; SCALE_BY_DISTANCE then shrinks them to ~half that at world view,
// so 1200 markers read as a density pattern instead of a pile of overlapping icons.
const MARKER_BASE_SCALE = 0.5;
const SELECTED_SCALE_BOOST = 1.5;
const SCALE_BY_DISTANCE = new Cesium.NearFarScalar(1.0e6, 1.0, 2.0e7, 0.52);
// Light fade with distance: dense clusters soften at world view, full opacity up close.
const TRANSLUCENCY_BY_DISTANCE = new Cesium.NearFarScalar(3.0e6, 1.0, 2.2e7, 0.8);
const NO_FADE = new Cesium.NearFarScalar(1.0, 1.0, 2.0, 1.0);
// The selection ring is never faded, and shrinks less, so the selected target always stands out.
const RING_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(1.0e6, 1.0, 2.0e7, 0.7);

// Initial framing: the whole disc centred in the viewport with a comfortable margin.
const HOME_VIEW = { lon: 15, lat: 22, height: 1.75e7 };

// ATC control zones are real ground geometry, not billboards: a 5–9 km circle has to grow and
// shrink with the camera exactly like the terrain under it, which a screen-space billboard
// cannot do. They live in `viewer.entities` (Cesium's Entity API) ALONGSIDE the
// BillboardCollection, in this same viewer — the tower billboard still marks the centre.
// Kept deliberately faint: the zones are context, not content, and there are hundreds of them.
const ZONE_FILL_ALPHA = 0.05;
const ZONE_SELECTED_FILL_ALPHA = 0.22;
const ZONE_OUTLINE_ALPHA = 0.4;
// A 5–9 km circle is sub-pixel beyond this range; skip drawing it at all.
const ZONE_MAX_VISIBLE_DISTANCE_M = 1.5e6;

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
        outlineWidth: 1,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
          0,
          ZONE_MAX_VISIBLE_DISTANCE_M
        )
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

/** Camera height above the target for insight fly-to: regional context, marker still legible. */
const FLY_TO_HEIGHT_M = 1_500_000;

export const GlobeView: FC = () => {
  const dispatch = useAppDispatch();
  const entities = useAppSelector((s) => s.entities.entities);
  const activeCategory = useAppSelector((s) => s.entities.activeCategoryFilter);
  const enabledSources = useAppSelector((s) => s.sources.enabledSourceIds);
  const sources = useAppSelector((s) => s.sources.sources);
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
  const ringRef = useRef<Cesium.Billboard | null>(null);
  const trailsRef = useRef<TrailLayer | null>(null);
  // Image currently on each billboard, so a colour change (color_by) swaps the texture only
  // when it actually changed.
  const imageById = useRef<Map<string, string>>(new Map());

  // Drop entities that outlived their source's display.ttl (the server prunes too).
  useTtlPruner();
  const spinningRef = useRef(true);
  const flyTo = useAppSelector((s) => s.insights.flyTo);

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
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.height)
    });
    (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'none';

    // One BillboardCollection for every entity marker — far cheaper than an Entity per target.
    const billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
    billboardsRef.current = billboards;
    viewerRef.current = viewer;
    // Trails (display.trail) under the markers: one PolylineCollection for every entity.
    trailsRef.current = new TrailLayer(viewer.scene);

    // Selection ring: one extra billboard in the same collection, moved onto whichever marker is
    // selected. Added first so it draws beneath the marker it surrounds.
    ringRef.current = billboards.add({
      show: false,
      position: Cesium.Cartesian3.ZERO,
      image: selectionRingMarker(),
      color: Cesium.Color.WHITE,
      scale: MARKER_BASE_SCALE * 1.9,
      scaleByDistance: RING_SCALE_BY_DISTANCE
    });

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

    // Pointer cursor over a marker. Picking renders a pick pass, so it runs at most once per
    // animation frame no matter how fast the mouse moves.
    let hoverPos: Cesium.Cartesian2 | null = null;
    let hoverFrame = 0;
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      hoverPos = movement.endPosition;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!hoverPos || viewer.isDestroyed()) return;
        const hit: unknown = viewer.scene.pick(hoverPos, 3, 3);
        const hitId = (hit as { id?: unknown } | undefined)?.id;
        viewer.canvas.style.cursor =
          typeof hitId === 'string' || hitId instanceof Cesium.Entity ? 'pointer' : '';
      });
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Idle "attract mode": spin slowly until the user grabs the globe, then stop so panning and
    // zoom feel natural. camera.rotate marks the scene dirty each tick, so it still renders
    // under requestRenderMode. LEFT_DOWN fires before LEFT_CLICK, so clicking a marker both
    // stops the spin AND selects the entity.
    spinningRef.current = true;
    const onTick = () => {
      if (spinningRef.current) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN_PER_TICK);
    };
    viewer.clock.onTick.addEventListener(onTick);

    const stopSpin = () => {
      spinningRef.current = false;
    };
    handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(stopSpin, Cesium.ScreenSpaceEventType.WHEEL);

    return () => {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      ringRef.current = null;
      trailsRef.current?.destroy();
      trailsRef.current = null;
      viewer.clock.onTick.removeEventListener(onTick);
      handler.destroy();
      byId.current.clear();
      imageById.current.clear();
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

  // Fly-to requests (e.g. clicking an AI insight). Keyed on the request only: a later entity
  // update must not yank the camera back.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!flyTo || !viewer || viewer.isDestroyed()) return;
    const entity = entities[flyTo.entityId];
    const target =
      entity ??
      (flyTo.latitude !== undefined && flyTo.longitude !== undefined
        ? { latitude: flyTo.latitude, longitude: flyTo.longitude, altitude: 0 }
        : null);
    if (!target) return;
    spinningRef.current = false;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        target.longitude,
        target.latitude,
        Math.max(renderHeight(target.altitude), 0) + FLY_TO_HEIGHT_M
      ),
      duration: 1.8
    });
  }, [flyTo]);

  // Trail length per source follows `display.trail.max_points`.
  useEffect(() => {
    dispatch(setTrailLimits(trailLimitsFromSources(sources)));
  }, [dispatch, sources]);

  // Upsert billboards whenever entities / filters / selection change.
  useEffect(() => {
    const viewer = viewerRef.current;
    const billboards = billboardsRef.current;
    if (!viewer || !billboards || viewer.isDestroyed()) return;
    const map = byId.current;
    const visibleIds = new Set<string>();
    let selectedPosition: Cesium.Cartesian3 | null = null;

    const now = Date.now();
    for (const entity of Object.values(entities)) {
      const source = sources[entity.source_id];
      if (isExpired(entity, source, now)) continue;
      const layerId = entityLayerId(entity, source);
      if (!isEntityVisible(entity, activeCategory, enabledSources, sourcesLoaded, layerId)) {
        continue;
      }
      visibleIds.add(entity.id);

      // Data-driven style from the source's `display` block (legacy category style otherwise).
      const style = resolveEntityStyle(entity, source);
      const image = style.icon
        ? markerForIcon(style.icon, style.color)
        : markerForCategory(entity.category);

      const position = Cesium.Cartesian3.fromDegrees(
        entity.longitude,
        entity.latitude,
        renderHeight(entity.altitude)
      );
      let bb = map.get(entity.id);
      if (!bb) {
        bb = billboards.add({
          id: entity.id,
          position,
          image,
          color: Cesium.Color.WHITE, // color is baked into the PNG pixels
          // Normal depth testing (NO disableDepthTestDistance): markers on the far side of the
          // globe are hidden behind it instead of being drawn through the limb.
          scaleByDistance: SCALE_BY_DISTANCE,
          translucencyByDistance: TRANSLUCENCY_BY_DISTANCE
        });
        map.set(entity.id, bb);
        imageById.current.set(entity.id, image);
      } else {
        bb.position = position;
        bb.show = true;
        if (imageById.current.get(entity.id) !== image) {
          bb.image = image;
          imageById.current.set(entity.id, image);
        }
      }
      const isSelected = entity.id === selectedId;
      bb.scale = (isSelected ? SELECTED_SCALE_BOOST : 1.0) * MARKER_BASE_SCALE * style.size;
      if (isSelected) {
        selectedPosition = position;
        bb.translucencyByDistance = NO_FADE; // the selected marker never fades
      } else if (bb.translucencyByDistance !== TRANSLUCENCY_BY_DISTANCE) {
        bb.translucencyByDistance = TRANSLUCENCY_BY_DISTANCE;
      }

      // ATC facilities additionally get their control-zone circle drawn on the globe.
      if (entity.category === ATC_ZONE_CATEGORY) {
        upsertZone(viewer, zonesById.current, entity, entity.id === selectedId);
      }

      // Directional glyphs rotate to heading (reported heading, else the bearing between the
      // last two trail points). Every silhouette points north, so one rotation fits all. The
      // aligned axis is the globe's Z, so the nose tracks true north as the camera turns.
      if (style.rotate) {
        const heading = entityHeadingRad(entity);
        if (heading !== null) {
          bb.rotation = -heading;
          bb.alignedAxis = Cesium.Cartesian3.UNIT_Z;
        }
      }
    }

    for (const [id, bb] of map) {
      if (visibleIds.has(id)) continue;
      if (entities[id]) {
        bb.show = false; // filtered out: hide, so re-enabling a layer costs nothing
      } else {
        // Gone from the store (ttl expiry / entity_remove): free the billboard for good.
        billboards.remove(bb);
        map.delete(id);
        imageById.current.delete(id);
      }
    }
    // Zones follow the same layer/source filters as their marker — hide, never remove, so a
    // re-enabled layer costs nothing to bring back (unless the entity itself is gone).
    for (const [id, zone] of zonesById.current) {
      if (visibleIds.has(id)) continue;
      if (entities[id]) {
        zone.show = false;
      } else {
        viewer.entities.remove(zone);
        zonesById.current.delete(id);
      }
    }
    trailsRef.current?.sync(
      entities,
      sources,
      visibleIds,
      (e) => resolveEntityStyle(e, sources[e.source_id]).color
    );
    const ring = ringRef.current;
    if (ring) {
      ring.show = selectedPosition !== null;
      if (selectedPosition) ring.position = selectedPosition;
    }
    viewer.scene.requestRender();
  }, [entities, sources, activeCategory, enabledSources, sourcesLoaded, selectedId]);

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
