import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** The shared category enum — must match the backend/YAML strings exactly. */
export type EntityCategory = 'satellite' | 'aircraft' | 'geological' | 'radiation' | 'maritime';

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
  metadata?: string | Record<string, unknown>;
  trail?: TrailPoint[];
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
    setSelectedEntityId(state, action: PayloadAction<string | null>) {
      state.selectedEntityId = action.payload;
    },
    setActiveCategoryFilter(state, action: PayloadAction<string | null>) {
      state.activeCategoryFilter = action.payload;
    }
  }
});

export const { setInitialEntities, upsertEntity, setSelectedEntityId, setActiveCategoryFilter } =
  entitiesSlice.actions;
export default entitiesSlice.reducer;
