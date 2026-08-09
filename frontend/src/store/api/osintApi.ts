import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { SourceRecord } from '../slices/sourcesSlice';
import type { EntityRecord } from '../slices/entitiesSlice';

/** One row of `GET /api/observations` — the historical track behind an entity. */
export interface ObservationRecord {
  id: string;
  entity_id: string;
  source_id: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  heading: number;
  timestamp: string;
  raw_payload?: string;
}

export interface SourcesResponse {
  sources: SourceRecord[];
}

export interface EntitiesResponse {
  total: number;
  limit: number;
  offset: number;
  entities: EntityRecord[];
}

export interface ObservationsResponse {
  total: number;
  limit: number;
  offset: number;
  observations: ObservationRecord[];
}

/** Bounding-box filter matching the backend's `min_lat/max_lat/min_lon/max_lon` query params. */
export interface EntitiesQueryArgs {
  category?: string;
  source_id?: string;
  min_lat?: number;
  max_lat?: number;
  min_lon?: number;
  max_lon?: number;
  limit?: number;
}

export const osintApi = createApi({
  reducerPath: 'osintApi',
  // Relative baseUrl: dev goes through the Vite `/api` proxy, prod is same-origin.
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    getSources: builder.query<SourcesResponse, void>({
      query: () => '/sources'
    }),
    getEntities: builder.query<EntitiesResponse, EntitiesQueryArgs | void>({
      query: (params) => ({
        url: '/entities',
        params: params ?? {}
      })
    }),
    getObservations: builder.query<ObservationsResponse, { entity_id: string; limit?: number }>({
      query: ({ entity_id, limit }) => ({
        url: '/observations',
        params: limit === undefined ? { entity_id } : { entity_id, limit }
      })
    })
  })
});

export const { useGetSourcesQuery, useGetEntitiesQuery, useGetObservationsQuery } = osintApi;
