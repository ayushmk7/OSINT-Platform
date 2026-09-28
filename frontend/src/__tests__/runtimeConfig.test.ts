import { vi } from 'vitest';
import * as Cesium from 'cesium';
import { configureStore } from '@reduxjs/toolkit';
import filterReducer from '../store/slices/filterSlice';
import { applyRuntimeConfig, fetchRuntimeConfig } from '../runtimeConfig';

function makeStore() {
  return configureStore({ reducer: { filter: filterReducer } });
}

describe('runtime config', () => {
  const originalToken = Cesium.Ion.defaultAccessToken;

  afterEach(() => {
    Cesium.Ion.defaultAccessToken = originalToken;
    vi.unstubAllGlobals();
  });

  it('applies the ion token, globe style and title', () => {
    const store = makeStore();
    applyRuntimeConfig(
      { appName: 'Ops Room', cesiumIonToken: 'tok-123', defaultGlobeStyle: 'blue_marble' },
      store.dispatch
    );
    expect(Cesium.Ion.defaultAccessToken).toBe('tok-123');
    expect(store.getState().filter.globeStyle).toBe('blue_marble');
    expect(document.title).toBe('Ops Room');
  });

  it('ignores unknown globe styles and a null token', () => {
    const store = makeStore();
    const before = store.getState().filter.globeStyle;
    applyRuntimeConfig({ cesiumIonToken: null, defaultGlobeStyle: 'not_a_style' }, store.dispatch);
    expect(Cesium.Ion.defaultAccessToken).toBe(originalToken);
    expect(store.getState().filter.globeStyle).toBe(before);
  });

  it('returns {} when the endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchRuntimeConfig()).resolves.toEqual({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    await expect(fetchRuntimeConfig()).resolves.toEqual({});
  });

  it('returns the parsed body on success', async () => {
    const body = { appName: 'MK-OSINT', cesiumIonToken: null, defaultGlobeStyle: 'tactical' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(fetchRuntimeConfig()).resolves.toEqual(body);
  });
});
