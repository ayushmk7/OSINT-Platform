// Live "Globe Style" engine — six interchangeable looks for the SAME Cesium viewer.
//
// The hard rule everywhere in this file: the globe surface stays FULLY OPAQUE.
// `globe.translucency.enabled` is never set to true and every `baseColor` is an
// alpha-1.0 CSS color. `ImageryLayer.alpha` (a texture-blend knob on a layer that sits ON the
// opaque surface) is a different thing and is used by the holographic look — it never makes the
// globe itself see-through.
//
// Everything a style adds is TRACKED so it can be removed again on the next switch:
//   * imagery layers            -> `layers[]`, removed from `viewer.imageryLayers`
//   * graticule / border lines  -> a `CustomDataSource` in `viewer.dataSources`
//   * city-light billboards     -> its own `BillboardCollection` in `scene.primitives`
//   * event listeners           -> `removers[]`
// The app's own markers live in the GlobeView-owned `BillboardCollection` and its ATC zones live
// in `viewer.entities`; NEITHER is ever touched here — that is why switching style cannot wipe
// them. The camera is never moved either.
import * as Cesium from 'cesium';

export type GlobeStyle =
  'tactical' | 'blue_marble' | 'night_lights' | 'neon_vector' | 'terrain_relief' | 'holographic';

export const GLOBE_STYLES: readonly GlobeStyle[] = [
  'tactical',
  'blue_marble',
  'night_lights',
  'neon_vector',
  'terrain_relief',
  'holographic'
] as const;

export const GLOBE_STYLE_LABELS: Record<GlobeStyle, string> = {
  tactical: 'Tactical Dark',
  blue_marble: 'Blue Marble',
  night_lights: 'Night Lights',
  neon_vector: 'Neon Vector',
  terrain_relief: 'Terrain Relief',
  holographic: 'Holographic'
};

export const DEFAULT_GLOBE_STYLE: GlobeStyle = 'tactical';

export function isGlobeStyle(value: unknown): value is GlobeStyle {
  return typeof value === 'string' && (GLOBE_STYLES as readonly string[]).includes(value);
}

/** Name given to the per-style overlay data source, so it is identifiable and removable. */
export const STYLE_OVERLAY_NAME = 'globe-style-overlay';

// Stadia's `{r}` retina placeholder is NOT understood by UrlTemplateImageryProvider — it must be
// left out of the template entirely (a literal "{r}" in the path 404s every tile).
const STADIA_DARK_URL = 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}.png';
const STADIA_TERRAIN_BG_URL =
  'https://tiles.stadiamaps.com/tiles/stamen_terrain_background/{z}/{x}/{y}@2x.png';
// ESRI's tile REST endpoint is {z}/{y}/{x} — ROW before COLUMN, the reverse of the usual slippy
// convention. Getting this the "obvious" way round yields a mirrored, garbage globe.
const ESRI_PHYSICAL_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}';

/** The project's original dark basemap. Kept as its own factory: the viewer boots with it. */
export function makeTacticalBaseLayer(): Cesium.ImageryLayer {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: STADIA_DARK_URL,
      maximumLevel: 18,
      credit: 'Stadia Maps, OpenMapTiles, OpenStreetMap'
    })
  );
}

const CYAN = '#12e8ff';
const NEON = '#00ffcc';

// ---------------------------------------------------------------------------------------------
// Country borders (Neon Vector). The GeoJSON is parsed once and the ring geometry cached, because
// a style switch must be cheap — re-parsing 838 KB on every toggle is not.
//
// GeoJsonDataSource draws polygon outlines through PolygonGraphics.outline, whose width is
// hardware-clamped to ~1px on virtually every GPU. So the rings are re-emitted as real
// PolylineGraphics with a PolylineGlowMaterialProperty, which is what actually gives a neon edge.
// ---------------------------------------------------------------------------------------------
let countryRingsPromise: Promise<Cesium.Cartesian3[][]> | null = null;

async function loadCountryRings(): Promise<Cesium.Cartesian3[][]> {
  if (!countryRingsPromise) {
    countryRingsPromise = (async () => {
      const ds = await Cesium.GeoJsonDataSource.load('/countries.geojson', {
        fill: Cesium.Color.TRANSPARENT,
        clampToGround: false
      });
      const now = Cesium.JulianDate.now();
      const rings: Cesium.Cartesian3[][] = [];
      for (const entity of ds.entities.values) {
        const hierarchy = entity.polygon?.hierarchy?.getValue(now);
        if (!hierarchy) continue;
        for (const ring of [hierarchy, ...(hierarchy.holes ?? [])]) {
          const positions = ring.positions;
          if (!positions || positions.length < 2) continue;
          rings.push([...positions, positions[0]]);
        }
      }
      return rings;
    })().catch((err: unknown) => {
      countryRingsPromise = null; // let a later switch retry instead of caching the failure
      throw err;
    });
  }
  return countryRingsPromise;
}

/**
 * `Scene.skyAtmosphere` is declared optional (it is only built when the viewer keeps its skybox
 * branch, which this app does), so funnel every access through one narrowing helper.
 */
function skyOf(scene: Cesium.Scene): Cesium.SkyAtmosphere {
  return scene.skyAtmosphere as Cesium.SkyAtmosphere;
}

function glowMaterial(color: string, alpha: number, glowPower: number) {
  return new Cesium.PolylineGlowMaterialProperty({
    color: Cesium.Color.fromCssColorString(color).withAlpha(alpha),
    glowPower,
    taperPower: 1.0
  });
}

/** Lat/lon cage drawn into `target`. `height` lifts it off the surface so it cannot z-fight. */
function addGraticule(
  target: Cesium.CustomDataSource,
  options: { step: number; color: string; height: number; alpha: number; glowPower: number }
): void {
  const { step, color, height, alpha, glowPower } = options;
  const minor = glowMaterial(color, alpha, glowPower);
  const major = glowMaterial(color, Math.min(1, alpha + 0.35), glowPower + 0.12);

  for (let lon = -180; lon < 180; lon += step) {
    const pts: number[] = [];
    for (let lat = -90; lat <= 90; lat += 2) pts.push(lon, lat, height);
    const isMajor = lon % 90 === 0;
    target.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(pts),
        width: isMajor ? 2.6 : 1.6,
        arcType: Cesium.ArcType.NONE,
        material: isMajor ? major : minor
      }
    });
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const pts: number[] = [];
    for (let lon = -180; lon <= 180; lon += 2) pts.push(lon, lat, height);
    const isMajor = lat === 0;
    target.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(pts),
        width: isMajor ? 3.0 : 1.6,
        arcType: Cesium.ArcType.NONE,
        material: isMajor ? major : minor
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// City lights (Night Lights). Emissive halo + hot core billboards on the night side only.
// ---------------------------------------------------------------------------------------------
const CITIES: ReadonlyArray<readonly [number, number, number]> = [
  // [lat, lon, weight 0-1]
  [35.68, 139.69, 1.0],
  [34.69, 135.5, 0.7],
  [37.57, 126.98, 0.8],
  [31.23, 121.47, 0.9],
  [39.9, 116.41, 0.85],
  [22.32, 114.17, 0.7],
  [23.13, 113.26, 0.72],
  [30.57, 104.07, 0.55],
  [14.6, 120.98, 0.62],
  [-6.21, 106.85, 0.7],
  [1.35, 103.82, 0.55],
  [13.76, 100.5, 0.62],
  [10.82, 106.63, 0.55],
  [23.81, 90.41, 0.62],
  [22.57, 88.36, 0.65],
  [13.08, 80.27, 0.58],
  [17.39, 78.49, 0.55],
  [12.97, 77.59, 0.62],
  [28.61, 77.21, 0.95],
  [19.08, 72.88, 0.88],
  [31.55, 74.34, 0.6],
  [24.86, 67.01, 0.68],
  [34.53, 69.17, 0.35],
  [41.3, 69.24, 0.38],
  [25.2, 55.27, 0.62],
  [35.69, 51.39, 0.65],
  [24.71, 46.68, 0.58],
  [33.31, 44.36, 0.55],
  [56.84, 60.61, 0.35],
  [55.75, 37.62, 0.85],
  [59.93, 30.34, 0.55],
  [50.45, 30.52, 0.55],
  [41.01, 28.98, 0.8],
  [39.93, 32.86, 0.45],
  [30.04, 31.24, 0.82],
  [31.2, 29.92, 0.45],
  [32.08, 34.78, 0.48],
  [15.5, 32.56, 0.32],
  [9.03, 38.74, 0.35],
  [-1.29, 36.82, 0.42],
  [-6.79, 39.21, 0.3],
  [-8.84, 13.23, 0.32],
  [-4.44, 15.27, 0.42],
  [-26.2, 28.05, 0.6],
  [-33.92, 18.42, 0.45],
  [6.52, 3.38, 0.65],
  [5.6, -0.19, 0.35],
  [5.36, -4.01, 0.32],
  [33.57, -7.59, 0.42],
  [36.75, 3.06, 0.42],
  [36.81, 10.18, 0.35],
  [32.89, 13.19, 0.3],
  [37.98, 23.73, 0.48],
  [44.43, 26.1, 0.42],
  [52.23, 21.01, 0.52],
  [48.21, 16.37, 0.48],
  [52.52, 13.4, 0.7],
  [41.9, 12.5, 0.58],
  [45.46, 9.19, 0.58],
  [48.14, 11.58, 0.48],
  [59.33, 18.07, 0.42],
  [53.55, 9.99, 0.45],
  [52.37, 4.9, 0.55],
  [50.85, 4.35, 0.5],
  [48.86, 2.35, 0.9],
  [41.39, 2.17, 0.55],
  [51.51, -0.13, 0.92],
  [53.35, -6.26, 0.38],
  [40.42, -3.7, 0.65],
  [38.72, -9.14, 0.45],
  [59.91, 10.75, 0.35],
  [40.71, -74.01, 0.95],
  [41.88, -87.63, 0.7],
  [29.76, -95.37, 0.6],
  [19.43, -99.13, 0.85],
  [34.05, -118.24, 0.9],
  [37.77, -122.42, 0.6],
  [47.61, -122.33, 0.5],
  [43.65, -79.38, 0.6],
  [45.5, -73.57, 0.45],
  [-23.55, -46.63, 0.82],
  [-22.91, -43.17, 0.65],
  [-34.6, -58.38, 0.7],
  [-12.05, -77.04, 0.55],
  [4.71, -74.07, 0.55],
  [-33.45, -70.67, 0.5],
  [-33.87, 151.21, 0.6],
  [-37.81, 144.96, 0.5]
];

/**
 * Soft radial sprite as a data URL. A plain 3-stop gradient shows concentric banding once bloom
 * runs over it, so the exponential falloff is emitted as many explicit stops instead.
 */
function glowSprite(size: number, rgb: string, peak: number, falloff: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const a = peak * Math.exp(-falloff * t * t) * (1 - t * t);
    gradient.addColorStop(t, `rgba(${rgb},${a.toFixed(4)})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL();
}

/** Unit vector toward the sun, in earth-fixed coordinates, at `time`. */
function sunDirectionEcef(time: Cesium.JulianDate): Cesium.Cartesian3 {
  const inertial = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time);
  const toFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(time);
  const fixed = Cesium.Matrix3.multiplyByVector(toFixed, inertial, new Cesium.Cartesian3());
  return Cesium.Cartesian3.normalize(fixed, new Cesium.Cartesian3());
}

// ---------------------------------------------------------------------------------------------
// Default snapshot / restore. Rather than hard-coding Cesium's defaults (which drift between
// releases), the pristine values are captured off the freshly built viewer and restored before
// each style is applied, so no knob can leak from one look into the next.
// ---------------------------------------------------------------------------------------------
type Bag = Record<string, unknown>;

function capture(source: object, keys: readonly string[]): Bag {
  const snapshot: Bag = {};
  for (const key of keys) {
    const value = (source as Bag)[key];
    snapshot[key] =
      value instanceof Cesium.Cartesian3
        ? Cesium.Cartesian3.clone(value)
        : value instanceof Cesium.Color
          ? Cesium.Color.clone(value)
          : value;
  }
  return snapshot;
}

function restore(target: object, snapshot: Bag): void {
  for (const [key, value] of Object.entries(snapshot)) {
    (target as Bag)[key] =
      value instanceof Cesium.Cartesian3
        ? Cesium.Cartesian3.clone(value)
        : value instanceof Cesium.Color
          ? Cesium.Color.clone(value)
          : value;
  }
}

// `maximumScreenSpaceError` is deliberately NOT in this list: it belongs to the LOD toggle, and a
// style switch must not stomp on the user's performance setting.
const GLOBE_KEYS = [
  'baseColor',
  'enableLighting',
  'dynamicAtmosphereLighting',
  'dynamicAtmosphereLightingFromSun',
  'showGroundAtmosphere',
  'showWaterEffect',
  'atmosphereLightIntensity',
  'atmosphereBrightnessShift',
  'atmosphereSaturationShift',
  'atmosphereHueShift',
  'atmosphereRayleighCoefficient',
  'atmosphereMieCoefficient',
  'atmosphereRayleighScaleHeight',
  'atmosphereMieScaleHeight',
  'lambertDiffuseMultiplier',
  'vertexShadowDarkness',
  'lightingFadeInDistance',
  'lightingFadeOutDistance',
  'nightFadeInDistance',
  'nightFadeOutDistance',
  'undergroundColor',
  'depthTestAgainstTerrain'
] as const;

const SKY_KEYS = [
  'show',
  'hueShift',
  'saturationShift',
  'brightnessShift',
  'perFragmentAtmosphere',
  'atmosphereLightIntensity',
  'atmosphereRayleighCoefficient',
  'atmosphereMieCoefficient',
  'atmosphereRayleighScaleHeight',
  'atmosphereMieScaleHeight',
  'atmosphereMieAnisotropy'
] as const;

const ATMOSPHERE_KEYS = [
  'hueShift',
  'saturationShift',
  'brightnessShift',
  'lightIntensity',
  'dynamicLighting'
] as const;

const BLOOM_KEYS = ['glowOnly', 'contrast', 'brightness', 'delta', 'sigma', 'stepSize'] as const;

/**
 * Owns the currently-applied look for one viewer.
 *
 * `apply()` is safe to call at any time: it tears the previous style down first, and an in-flight
 * async style (GeoJSON / single-tile fetch) that is superseded is discarded via a generation
 * counter rather than landing on top of the newer look.
 */
export class GlobeStyleController {
  private readonly viewer: Cesium.Viewer;
  private readonly defaults: {
    globe: Bag;
    sky: Bag;
    atmosphere: Bag;
    bloom: Bag;
    scene: Bag;
    light: Cesium.Light | undefined;
  };
  private layers: Cesium.ImageryLayer[] = [];
  private dataSources: Cesium.CustomDataSource[] = [];
  private primitives: Cesium.BillboardCollection[] = [];
  private removers: Array<() => void> = [];
  private generation = 0;
  private applied: GlobeStyle | null = null;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    const { scene } = viewer;
    this.defaults = {
      globe: capture(scene.globe, GLOBE_KEYS),
      sky: capture(skyOf(scene), SKY_KEYS),
      atmosphere: capture(scene.atmosphere, ATMOSPHERE_KEYS),
      bloom: capture(scene.postProcessStages.bloom.uniforms as object, BLOOM_KEYS),
      scene: {
        highDynamicRange: scene.highDynamicRange,
        skyBoxShow: scene.skyBox?.show ?? true,
        sunShow: scene.sun?.show ?? true,
        moonShow: scene.moon?.show ?? true,
        fogEnabled: scene.fog.enabled
      },
      light: scene.light
    };
  }

  get currentStyle(): GlobeStyle | null {
    return this.applied;
  }

  /** Remove everything the active style added, and put every scene knob back to its default. */
  private teardown(): void {
    const { viewer } = this;
    if (viewer.isDestroyed()) return;
    const { scene } = viewer;

    for (const remove of this.removers) remove();
    this.removers = [];

    for (const layer of this.layers) {
      if (viewer.imageryLayers.contains(layer)) viewer.imageryLayers.remove(layer, true);
    }
    this.layers = [];
    // Defensive: `imageryProvider: false` is dead in Cesium 1.144 and a stray boot layer would
    // otherwise sit under a vector look. Only imagery is nuked — never entities or primitives.
    viewer.imageryLayers.removeAll();

    for (const ds of this.dataSources) {
      if (viewer.dataSources.contains(ds)) viewer.dataSources.remove(ds, true);
    }
    this.dataSources = [];

    for (const collection of this.primitives) {
      if (!collection.isDestroyed() && scene.primitives.contains(collection)) {
        scene.primitives.remove(collection); // destroys only OUR collection, not the marker layer
      }
    }
    this.primitives = [];

    restore(scene.globe, this.defaults.globe);
    restore(skyOf(scene), this.defaults.sky);
    restore(scene.atmosphere, this.defaults.atmosphere);
    restore(scene.postProcessStages.bloom.uniforms as object, this.defaults.bloom);
    scene.postProcessStages.bloom.enabled = false;
    scene.highDynamicRange = this.defaults.scene.highDynamicRange as boolean;
    if (scene.skyBox) scene.skyBox.show = this.defaults.scene.skyBoxShow as boolean;
    if (scene.sun) scene.sun.show = this.defaults.scene.sunShow as boolean;
    if (scene.moon) scene.moon.show = this.defaults.scene.moonShow as boolean;
    scene.fog.enabled = this.defaults.scene.fogEnabled as boolean;
    scene.light = this.defaults.light ?? new Cesium.SunLight();

    // The one invariant that must hold in EVERY style, restored default or not.
    this.assertOpaque();
  }

  /** The non-negotiable: an opaque globe surface. Cheap enough to re-assert on every switch. */
  private assertOpaque(): void {
    const { globe } = this.viewer.scene;
    globe.translucency.enabled = false;
    globe.translucency.frontFaceAlpha = 1.0;
    globe.translucency.backFaceAlpha = 1.0;
    // Typed as `Color`, but Cesium treats `undefined` as "no see-through underside".
    (globe as { undergroundColor?: Cesium.Color }).undergroundColor = undefined;
  }

  private addLayer(layer: Cesium.ImageryLayer): Cesium.ImageryLayer {
    this.viewer.imageryLayers.add(layer);
    this.layers.push(layer);
    return layer;
  }

  private newOverlay(suffix: string): Cesium.CustomDataSource {
    const ds = new Cesium.CustomDataSource(`${STYLE_OVERLAY_NAME}:${suffix}`);
    this.dataSources.push(ds);
    return ds;
  }

  /** Switch to `style`. Never moves the camera, never touches app entities or marker billboards. */
  async apply(style: GlobeStyle): Promise<void> {
    const { viewer } = this;
    if (viewer.isDestroyed()) return;
    const generation = ++this.generation;
    const stale = () => viewer.isDestroyed() || generation !== this.generation;

    this.teardown();
    this.applied = style;
    const { scene } = viewer;
    const { globe } = scene;

    switch (style) {
      case 'tactical':
        this.applyTactical();
        break;
      case 'blue_marble':
        this.applyBlueMarble();
        break;
      case 'night_lights':
        this.applyNightLights();
        break;
      case 'neon_vector':
        this.applyNeonVector();
        break;
      case 'terrain_relief':
        this.applyTerrainRelief();
        break;
      case 'holographic':
        this.applyHolographic();
        break;
    }

    // Belt and braces: whatever a style did above, the surface is opaque.
    this.assertOpaque();
    globe.baseColor = globe.baseColor.withAlpha(1.0);
    scene.requestRender();

    // Async parts (network-backed geometry/texture) land afterwards and are dropped if the user
    // has already switched again.
    if (style === 'neon_vector') await this.loadNeonBorders(stale);
    if (style === 'holographic') await this.loadHologramMask(stale);
    if (!stale()) scene.requestRender();
  }

  /** 1 — Tactical Dark: the project's original Stadia "Alidade Smooth Dark" basemap. */
  private applyTactical(): void {
    const { scene } = this.viewer;
    this.addLayer(makeTacticalBaseLayer()).alpha = 1.0;
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#000000');
    scene.backgroundColor = Cesium.Color.BLACK;
  }

  /** 2 — Blue Marble: photoreal natural colour, from Cesium's own bundled Natural Earth II TMS. */
  private applyBlueMarble(): void {
    const { scene } = this.viewer;
    const { globe } = scene;
    // The plain `TileMapServiceImageryProvider` constructor is REMOVED in 1.144 — the async
    // `.fromUrl()` + `ImageryLayer.fromProviderAsync()` pair is the only way in.
    const layer = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
      ),
      {}
    );
    layer.brightness = 1.05;
    layer.saturation = 1.08;
    layer.gamma = 1.0;
    layer.alpha = 1.0;
    this.addLayer(layer);

    globe.baseColor = Cesium.Color.fromCssColorString('#12395c');
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    globe.showGroundAtmosphere = true;
    // Default intensity (10) lays a milky veil over the whole disc and blows the Sahara to white.
    globe.atmosphereLightIntensity = 3.0;
    globe.atmosphereBrightnessShift = -0.05;
    globe.atmosphereSaturationShift = 0.1;
    globe.showWaterEffect = true;

    skyOf(scene).show = true;
    skyOf(scene).atmosphereLightIntensity = 20.0; // default 50 = blown out
    skyOf(scene).saturationShift = 0.1;
    skyOf(scene).brightnessShift = -0.05;
    scene.fog.enabled = true;
    scene.highDynamicRange = false;
    if (scene.skyBox) scene.skyBox.show = true;
    if (scene.sun) scene.sun.show = true;
  }

  /** 3 — Night Lights: crushed night-side Earth with emissive city glow. */
  private applyNightLights(): void {
    const { scene } = this.viewer;
    const { globe } = scene;

    // A label-free relief basemap: alidade_smooth_dark bakes country/city TYPE into the raster,
    // which at globe zoom reads as a flat map, not an orbital photo.
    const layer = this.addLayer(
      new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: STADIA_TERRAIN_BG_URL,
          credit: 'Stadia Maps / Stamen Design / OpenStreetMap',
          tileWidth: 512,
          tileHeight: 512,
          maximumLevel: 8
        })
      )
    );
    // ImageryLayer.gamma is pow(color, 1/gamma) — INVERTED vs scene gamma, so <1 darkens. All the
    // crushing is done with gamma + brightness: `contrast` is a per-channel affine push away from
    // 0.5 and tears this beige-land/blue-water raster into violent purple.
    layer.contrast = 1.0;
    layer.saturation = 0.42;
    layer.brightness = 0.1;
    layer.gamma = 0.46;
    layer.alpha = 1.0;

    globe.baseColor = Cesium.Color.fromCssColorString('#01030a');
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    globe.dynamicAtmosphereLightingFromSun = true;
    globe.showGroundAtmosphere = true;
    globe.showWaterEffect = false;
    globe.lambertDiffuseMultiplier = 2.2;
    globe.vertexShadowDarkness = 0.32; // night-side floor brightness
    globe.atmosphereLightIntensity = 14.0;
    globe.atmosphereMieCoefficient = new Cesium.Cartesian3(12.0e-6, 12.0e-6, 12.0e-6);
    globe.atmosphereRayleighScaleHeight = 11000.0;
    globe.atmosphereMieScaleHeight = 4200.0;
    globe.lightingFadeOutDistance = 1.0e7;
    globe.lightingFadeInDistance = 2.0e7;
    globe.nightFadeOutDistance = 1.0e7;
    globe.nightFadeInDistance = 5.0e7;

    const sky = skyOf(scene);
    sky.show = true;
    sky.perFragmentAtmosphere = true;
    sky.atmosphereLightIntensity = 22.0;
    sky.atmosphereRayleighCoefficient = new Cesium.Cartesian3(4.0e-6, 10.0e-6, 26.0e-6);
    sky.atmosphereMieCoefficient = new Cesium.Cartesian3(12.0e-6, 12.0e-6, 12.0e-6);
    sky.atmosphereRayleighScaleHeight = 11000.0;
    sky.atmosphereMieScaleHeight = 4600.0;
    sky.atmosphereMieAnisotropy = 0.92;
    sky.hueShift = -0.045;
    sky.saturationShift = 0.3;
    sky.brightnessShift = 0.22;

    scene.atmosphere.lightIntensity = 12.0;
    scene.atmosphere.hueShift = -0.045;
    scene.atmosphere.saturationShift = 0.25;
    scene.atmosphere.brightnessShift = 0.1;
    scene.fog.enabled = false;
    if (scene.skyBox) scene.skyBox.show = true;
    if (scene.sun) scene.sun.show = false; // no blown-out sun disc; we want the rim
    if (scene.moon) scene.moon.show = false;
    if (scene.highDynamicRangeSupported) scene.highDynamicRange = true;

    const bloom = scene.postProcessStages.bloom;
    bloom.enabled = true;
    bloom.uniforms.glowOnly = false;
    bloom.uniforms.contrast = 128;
    bloom.uniforms.brightness = -0.28;
    bloom.uniforms.delta = 1.4;
    bloom.uniforms.sigma = 2.6;
    bloom.uniforms.stepSize = 1.6;

    this.addCityLights();
  }

  /** City glow, night side only, in OUR OWN BillboardCollection (the marker layer is untouched). */
  private addCityLights(): void {
    const { scene } = this.viewer;
    const halo = glowSprite(128, '255,170,68', 0.85, 9.0);
    const core = glowSprite(64, '255,238,198', 1.0, 16.0);
    if (!halo || !core) return;

    const collection = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    this.primitives.push(collection);

    const sunDir = sunDirectionEcef(this.viewer.clock.currentTime);
    for (const [lat, lon, weight] of CITIES) {
      const position = Cesium.Cartesian3.fromDegrees(lon, lat);
      const up = Cesium.Cartesian3.normalize(position, new Cesium.Cartesian3());
      // cos(solar zenith): 1 = local noon, 0 = terminator, -1 = local midnight.
      const sunCos = Cesium.Cartesian3.dot(up, sunDir);
      const nightMix = Cesium.Math.clamp((0.12 - sunCos) / 0.34, 0.0, 1.0);
      if (nightMix <= 0.01) continue;

      const a = nightMix * weight;
      const haloSize = 12 + 30 * weight;
      collection.add({
        position,
        image: halo,
        width: haloSize,
        height: haloSize,
        color: new Cesium.Color(1.0, 0.72, 0.34, 0.74 * a)
      });
      const coreSize = 4.5 + 6.5 * weight;
      collection.add({
        position,
        image: core,
        width: coreSize,
        height: coreSize,
        color: new Cesium.Color(1.0, 0.93, 0.78, 0.98 * a)
      });
    }
  }

  /** 4 — Neon Vector: zero photographic imagery, solid dark base + glowing country wireframe. */
  private applyNeonVector(): void {
    const { scene } = this.viewer;
    const { globe } = scene;

    globe.baseColor = Cesium.Color.fromCssColorString('#050b14');
    globe.showGroundAtmosphere = false; // would wash the flat fill out to milky blue
    globe.enableLighting = false;
    globe.showWaterEffect = false;
    globe.depthTestAgainstTerrain = true;

    scene.backgroundColor = Cesium.Color.BLACK;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;
    scene.highDynamicRange = false;
    const sky = skyOf(scene);
    sky.show = true;
    sky.hueShift = -0.15;
    sky.saturationShift = 0.35;
    sky.brightnessShift = -0.45;

    const grid = this.newOverlay('graticule');
    addGraticule(grid, { step: 30, color: '#0e5f70', height: 12000, alpha: 0.55, glowPower: 0.16 });
    void this.viewer.dataSources.add(grid);
  }

  /** The 838 KB border geometry, added after the flat base is already on screen. */
  private async loadNeonBorders(stale: () => boolean): Promise<void> {
    let rings: Cesium.Cartesian3[][];
    try {
      rings = await loadCountryRings();
    } catch (err) {
      console.error('Globe style: country borders failed to load', err);
      return;
    }
    if (stale()) return;

    const borders = this.newOverlay('borders');
    const material = glowMaterial(NEON, 1.0, 0.18);
    for (const positions of rings) {
      borders.entities.add({
        polyline: { positions, width: 2, arcType: Cesium.ArcType.GEODESIC, material }
      });
    }
    await this.viewer.dataSources.add(borders);
    if (stale()) return;
    this.viewer.scene.requestRender();
  }

  /** 5 — Terrain Relief: ESRI World Physical Map, graded to an atlas palette. */
  private applyTerrainRelief(): void {
    const { scene } = this.viewer;
    const { globe } = scene;

    const layer = this.addLayer(
      new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: ESRI_PHYSICAL_URL,
          credit: 'Esri, US National Park Service',
          maximumLevel: 8
        })
      )
    );
    // Deepen the ocean and push the land toward atlas olive/tan/brown so the hillshade reads and
    // the look cannot be mistaken for the Blue Marble raster. `gamma < 1` darkens (the knob is
    // inverted vs scene gamma).
    layer.brightness = 0.9;
    layer.contrast = 1.45;
    layer.saturation = 1.45;
    layer.gamma = 0.85;
    layer.hue = 0.02;
    layer.alpha = 1.0;

    globe.baseColor = Cesium.Color.fromCssColorString('#7a6f57');
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    // Ground atmosphere washes the relief raster to near-white at globe scale; the limb glow
    // comes from skyAtmosphere instead.
    globe.showGroundAtmosphere = false;
    globe.atmosphereBrightnessShift = -0.25;
    globe.atmosphereSaturationShift = -0.1;
    globe.showWaterEffect = false;

    skyOf(scene).show = true;
    skyOf(scene).brightnessShift = -0.15; // a bright limb halo milks the relief out at globe scale
    skyOf(scene).saturationShift = -0.15;
    skyOf(scene).atmosphereLightIntensity = 18.0;
    scene.fog.enabled = false;
    scene.highDynamicRange = false;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#04060a');
    if (scene.skyBox) scene.skyBox.show = true;
    if (scene.sun) scene.sun.show = false; // no lens-flare blowout; the terminator still reads
    if (scene.moon) scene.moon.show = false;
  }

  /** 6 — Holographic: dark sphere, cyan lat/lon cage, bloom. */
  private applyHolographic(): void {
    const { scene } = this.viewer;
    const { globe } = scene;

    globe.baseColor = Cesium.Color.fromCssColorString('#001a22');
    globe.showGroundAtmosphere = false; // photographic blue veil kills the hologram read
    globe.enableLighting = false;
    globe.dynamicAtmosphereLighting = false;
    globe.showWaterEffect = false;
    globe.depthTestAgainstTerrain = false;

    scene.backgroundColor = Cesium.Color.BLACK;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;
    scene.highDynamicRange = false;

    const sky = skyOf(scene);
    sky.show = true;
    sky.hueShift = -0.045; // blue -> cyan; shifting further turns the limb green
    sky.saturationShift = 0.3;
    sky.brightnessShift = 0.55;
    sky.atmosphereLightIntensity = 26.0;
    // Blue must stay >= green or the limb clips to green at this intensity.
    sky.atmosphereRayleighCoefficient = new Cesium.Cartesian3(2.0e-6, 10.0e-6, 20.0e-6);
    sky.atmosphereMieCoefficient = new Cesium.Cartesian3(6.0e-6, 12.0e-6, 18.0e-6);
    sky.atmosphereRayleighScaleHeight = 26000.0;
    sky.atmosphereMieScaleHeight = 9000.0;

    scene.atmosphere.hueShift = -0.12;
    scene.atmosphere.saturationShift = 0.4;
    scene.atmosphere.brightnessShift = 0.6;
    scene.atmosphere.lightIntensity = 12.0;
    scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.NONE;

    // Bloom — NOT the atmosphere — is what actually sells the outward-bleeding glow. It is a
    // post-process pass, so it cannot affect globe opacity.
    const bloom = scene.postProcessStages.bloom;
    bloom.enabled = true;
    bloom.uniforms.glowOnly = false;
    bloom.uniforms.contrast = 128.0;
    bloom.uniforms.brightness = -0.35;
    bloom.uniforms.delta = 1.6;
    bloom.uniforms.sigma = 4.0;
    bloom.uniforms.stepSize = 2.2;

    // Light the limb from the camera so the whole rim rings instead of a sunlit crescent.
    const holoLight = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(0, 0, -1),
      intensity: 3.0,
      color: Cesium.Color.fromCssColorString('#7ffcff')
    });
    scene.light = holoLight;
    const removeListener = scene.preRender.addEventListener(() => {
      Cesium.Cartesian3.clone(scene.camera.directionWC, holoLight.direction);
    });
    this.removers.push(removeListener);

    const grid = this.newOverlay('graticule');
    addGraticule(grid, { step: 15, color: CYAN, height: 18000, alpha: 0.55, glowPower: 0.18 });
    void this.viewer.dataSources.add(grid);
  }

  /**
   * Flat, pre-thresholded land silhouette. `layer.alpha` here dims the TEXTURE only — the opaque
   * #001a22 globe surface is what shows through it, so the sphere is still solid.
   */
  private async loadHologramMask(stale: () => boolean): Promise<void> {
    let provider: Cesium.SingleTileImageryProvider;
    try {
      provider = await Cesium.SingleTileImageryProvider.fromUrl('/land_mask.png', {
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
      });
    } catch (err) {
      console.error('Globe style: hologram land mask failed to load', err);
      return;
    }
    if (stale()) return;
    const layer = this.addLayer(new Cesium.ImageryLayer(provider));
    layer.alpha = 0.55;
    this.viewer.scene.requestRender();
  }

  /** Called when the viewer goes away: drop our own additions, leave the app's alone. */
  destroy(): void {
    this.generation++;
    if (!this.viewer.isDestroyed()) this.teardown();
    this.applied = null;
  }
}
