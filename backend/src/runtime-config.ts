import { Request, Response } from 'express';

/**
 * Client-safe runtime settings served at GET /config.json.
 *
 * This is an explicit ALLOW-LIST: every field is read from one named MKOSINT_* variable and
 * nothing else from `process.env` is ever copied in, so a server secret (source API keys, DB
 * paths, ...) cannot leak through here by accident. The Cesium ion token is a browser token by
 * design (Cesium sends it from the client on every ion request), so exposing it is expected;
 * scope it to the public assets you need in the ion dashboard.
 */
export interface RuntimeConfig {
  appName: string;
  cesiumIonToken: string | null;
  /** Globe style id; the frontend validates it and ignores unknown values. */
  defaultGlobeStyle: string | null;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    appName: nonEmpty(env.MKOSINT_APP_NAME) ?? 'MK-OSINT',
    cesiumIonToken: nonEmpty(env.MKOSINT_CESIUM_ION_TOKEN),
    defaultGlobeStyle: nonEmpty(env.MKOSINT_DEFAULT_GLOBE_STYLE)
  };
}

export function runtimeConfigHandler(_req: Request, res: Response): void {
  // Read per request and never cached: the SPA fetches it once at startup, and a container
  // restart with new env must take effect on the next page load.
  res.set('Cache-Control', 'no-store').json(getRuntimeConfig());
}
