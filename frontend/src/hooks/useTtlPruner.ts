import { useEffect } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '../store';
import { removeEntities } from '../store/slices/entitiesSlice';
import { isExpired } from '../components/layerStyle';

/** How often the client drops entities that outlived their source's `display.ttl`. */
export const TTL_PRUNE_INTERVAL_MS = 15_000;

/** Ids of entities whose source ttl has elapsed at `now`. */
export function expiredEntityIds(state: RootState, now: number): string[] {
  const { sources } = state.sources;
  const ids: string[] = [];
  for (const ent of Object.values(state.entities.entities)) {
    if (isExpired(ent, sources[ent.source_id], now)) ids.push(ent.id);
  }
  return ids;
}

/**
 * Client-side ttl: the backend prunes expired entities once a minute and broadcasts
 * `entity_remove`, but a client that missed that frame (or whose clock ran ahead of the sweep)
 * still hides them here, so stale contacts never linger on the globe or in the legend counts.
 */
export function useTtlPruner(intervalMs: number = TTL_PRUNE_INTERVAL_MS): void {
  const store = useStore<RootState>();
  useEffect(() => {
    const prune = () => {
      const ids = expiredEntityIds(store.getState(), Date.now());
      if (ids.length > 0) store.dispatch(removeEntities(ids));
    };
    prune();
    const id = window.setInterval(prune, intervalMs);
    return () => window.clearInterval(id);
  }, [store, intervalMs]);
}
