import * as Cesium from 'cesium';
import type { AppDispatch } from './store';
import { setGlobeStyle } from './store/slices/filterSlice';
import { isGlobeStyle } from './components/globeStyles';

/** Client-safe settings served by the backend at GET /config.json. */
export interface RuntimeConfig {
  appName: string;
  cesiumIonToken: string | null;
  defaultGlobeStyle: string | null;
}

/**
 * Fetches /config.json with a short timeout. Never throws: a missing or slow endpoint (e.g. an
 * older backend, or a static host without it) just means the built-in defaults apply.
 */
export async function fetchRuntimeConfig(timeoutMs = 3000): Promise<Partial<RuntimeConfig>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/config.json', { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return {};
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Partial<RuntimeConfig>) : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** Applies the settings: Cesium ion token, default globe style and document title. */
export function applyRuntimeConfig(config: Partial<RuntimeConfig>, dispatch: AppDispatch): void {
  if (typeof config.cesiumIonToken === 'string' && config.cesiumIonToken) {
    Cesium.Ion.defaultAccessToken = config.cesiumIonToken;
  }
  if (isGlobeStyle(config.defaultGlobeStyle)) {
    dispatch(setGlobeStyle(config.defaultGlobeStyle));
  }
  if (typeof config.appName === 'string' && config.appName) {
    document.title = config.appName;
  }
}

export async function loadRuntimeConfig(dispatch: AppDispatch): Promise<void> {
  applyRuntimeConfig(await fetchRuntimeConfig(), dispatch);
}
