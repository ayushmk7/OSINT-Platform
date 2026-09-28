import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * The shared category enum — must match the backend `ENTITY_CATEGORIES` strings exactly.
 * Every member has its own silhouette + color in `globeMarkers`; `atc_zone` additionally draws
 * a control-zone circle on the globe, sized from its `radius_km` metadata.
 */
export type EntityCategory =
  'satellite' | 'aircraft' | 'geological' | 'radiation' | 'maritime' | 'atc_zone';

export interface TrailPoint {
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: string;
}

/** Mirrors the `entities` table returned by `GET /api/entities` and WS `entity_update` frames. */
export interface EntityRecord {
  id: string;
  source_id: string;
  category: EntityCategory | string;
  name: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: string;
  /** Always a parsed object on the wire (REST, `initial_state`, `entity_update`). */
  metadata?: Record<string, unknown>;
  /** Latest speed / heading when the frame carries them (live updates, initial snapshot). */
  speed?: number | null;
  heading?: number | null;
  trail?: TrailPoint[];
}

/**
 * The backend always sends `metadata` as a parsed object (REST and every WS frame), so there is
 * nothing to JSON.parse. Still guard the shape and always hand back a record: an unexpected
 * value must never break a render — callers just see no fields.
 */
export function parseEntityMetadata(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

export interface EntitiesState {
  entities: Record<string, EntityRecord>;
  selectedEntityId: string | null;
  activeCategoryFilter: string | null;
}

/** Trail points retained per entity (bounded so long-running sessions don't grow forever). */
export const MAX_TRAIL_POINTS = 20;

const initialState: EntitiesState = {
  entities: {},
  selectedEntityId: null,
  activeCategoryFilter: null
};

function pointOf(ent: EntityRecord): TrailPoint {
  return {
    latitude: ent.latitude,
    longitude: ent.longitude,
    altitude: ent.altitude,
    timestamp: ent.timestamp
  };
}

const entitiesSlice = createSlice({
  name: 'entities',
  initialState,
  reducers: {
    setInitialEntities(state, action: PayloadAction<EntityRecord[]>) {
      state.entities = {};
      action.payload.forEach((ent) => {
        state.entities[ent.id] = { ...ent, trail: [pointOf(ent)] };
      });
    },
    upsertEntity(state, action: PayloadAction<EntityRecord>) {
      const ent = action.payload;
      const existing = state.entities[ent.id];
      const newTrail = existing?.trail ? [...existing.trail] : [];
      newTrail.push(pointOf(ent));
      if (newTrail.length > MAX_TRAIL_POINTS) {
        newTrail.shift();
      }
      state.entities[ent.id] = { ...ent, trail: newTrail };
    },
    /** Server-side ttl expiry (`entity_remove`) or client-side ttl pruning. */
    removeEntities(state, action: PayloadAction<string[]>) {
      for (const id of action.payload) {
        delete state.entities[id];
        if (state.selectedEntityId === id) state.selectedEntityId = null;
      }
    },
    setSelectedEntityId(state, action: PayloadAction<string | null>) {
      state.selectedEntityId = action.payload;
    },
    setActiveCategoryFilter(state, action: PayloadAction<string | null>) {
      state.activeCategoryFilter = action.payload;
    }
  }
});

export const {
  setInitialEntities,
  upsertEntity,
  removeEntities,
  setSelectedEntityId,
  setActiveCategoryFilter
} = entitiesSlice.actions;
export default entitiesSlice.reducer;
