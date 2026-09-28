/**
 * The optional `layer:` and `display:` blocks of a source YAML: which legend layer a source
 * feeds, and how its entities are drawn (icon, colour, colour ramp, size, rotation, trail,
 * time-to-live, entity-card fields).
 *
 * Validation is strict: a present-but-malformed block rejects the whole file with a readable
 * error, so a typo never silently renders as a grey dot. The one deliberate exception is an
 * unknown `display.icon`, which only warns and falls back to `dot` (the frontend icon set grows
 * independently of the engine).
 */

/** Legend groups, in the order the frontend lists them. */
export const LAYER_GROUPS = [
  'Aviation',
  'Maritime',
  'Space',
  'Hazards',
  'Weather',
  'Environment',
  'Conflict',
  'Infrastructure',
  'Cyber',
  'News',
  'Other'
] as const;
export type LayerGroup = (typeof LAYER_GROUPS)[number];

/** Icon registry keys the frontend knows how to draw. */
export const ICON_KEYS = [
  'dot',
  'plane',
  'helicopter',
  'ship',
  'satellite',
  'rocket',
  'iss',
  'quake',
  'volcano',
  'fire',
  'storm',
  'lightning',
  'flood',
  'tsunami',
  'radiation',
  'nuclear',
  'biohazard',
  'factory',
  'power',
  'cable',
  'tower',
  'antenna',
  'port',
  'airport',
  'military',
  'conflict',
  'explosion',
  'alert',
  'news',
  'shield',
  'bug',
  'buoy',
  'balloon',
  'camera',
  'pin'
] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export const FIELD_FORMATS = ['text', 'number', 'datetime', 'link', 'bool'] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

export const DEFAULT_ICON: IconKey = 'dot';
export const DEFAULT_COLOR = '#9ca3af';
export const DEFAULT_GROUP: LayerGroup = 'Other';
export const DEFAULT_TRAIL_POINTS = 20;
export const MAX_TRAIL_POINTS = 1000;
export const MAX_SIZE = 10;
/** Default client-side cap on how many entities of one layer are loaded and drawn. */
export const DEFAULT_MAX_VISIBLE = 2000;
/** Hard ceiling for `display.max_visible`: beyond this the globe's frame rate suffers. */
export const MAX_VISIBLE_CEILING = 5000;

/** Layer ids / categories: lowercase snake case. */
export const LAYER_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export interface ResolvedLayer {
  id: string;
  name: string;
  group: LayerGroup;
  description: string;
  /** Whether the layer is shown on first load (the viewer's own toggles override it). */
  default_visible: boolean;
}

export interface ColorBy {
  field: string;
  /** Ascending numeric stops, colours interpolated between them. */
  stops?: Array<[number, string]>;
  /** Exact-match lookup (value stringified). */
  map?: Record<string, string>;
  /** Colour when the value is missing or unmatched. Defaults to `display.color`. */
  default?: string;
}

export interface DisplayField {
  path: string;
  label: string;
  format: FieldFormat;
  precision?: number;
  prefix?: string;
  suffix?: string;
}

export interface ResolvedDisplay {
  /** False when the source had no `display:` block (the frontend then uses its legacy style). */
  declared: boolean;
  icon: string;
  color: string;
  color_by?: ColorBy;
  size: number;
  rotate: boolean;
  trail: { enabled: boolean; max_points: number };
  /** The YAML ttl string, or null when entities never expire. */
  ttl: string | null;
  /** `ttl` in whole seconds, or null. */
  ttl_seconds: number | null;
  fields: DisplayField[];
  /** Most entities of this layer the frontend loads and draws. */
  max_visible: number;
}

/**
 * Parse a TTL: "90s", "15m", "24h", "7d", or a bare positive number of seconds.
 * Returns null for anything unusable.
 */
export function parseTtlSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(s|m|h|d)?\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] || 's').toLowerCase();
  const factor = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return Math.max(1, Math.round(amount * factor));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERN.test(value);
}

/** Best-effort snake_case of a free-form string (used only for the layer_type default). */
export function toLayerId(value: unknown): string {
  const snake = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!snake) return 'other';
  return /^[a-z]/.test(snake) ? snake : `l_${snake}`;
}

/** Every problem in the `layer:` / `display:` blocks. Empty list = usable (or absent). */
export function validateLayerDisplay(config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const layer = config.layer;
  const display = config.display;

  if (layer !== undefined) {
    if (!isPlainObject(layer)) {
      errors.push('layer must be a mapping');
    } else {
      if (layer.id !== undefined) {
        if (typeof layer.id !== 'string' || !LAYER_ID_PATTERN.test(layer.id)) {
          errors.push(`layer.id ${JSON.stringify(layer.id)} must be lowercase snake_case`);
        }
      }
      for (const key of ['name', 'description'] as const) {
        if (layer[key] !== undefined && typeof layer[key] !== 'string') {
          errors.push(`layer.${key} must be a string`);
        }
      }
      if (layer.default_visible !== undefined && typeof layer.default_visible !== 'boolean') {
        errors.push('layer.default_visible must be true or false');
      }
      if (
        layer.group !== undefined &&
        !(LAYER_GROUPS as readonly unknown[]).includes(layer.group)
      ) {
        errors.push(
          `invalid layer.group ${JSON.stringify(layer.group)} ` +
            `(expected one of: ${LAYER_GROUPS.join(', ')})`
        );
      }
    }
  }

  const category = (config.entity as Record<string, unknown> | undefined)?.category;
  if (
    category !== undefined &&
    (typeof category !== 'string' || !LAYER_ID_PATTERN.test(category))
  ) {
    errors.push(`entity.category ${JSON.stringify(category)} must be lowercase snake_case`);
  }

  if (display === undefined) return errors;
  if (!isPlainObject(display)) {
    errors.push('display must be a mapping');
    return errors;
  }

  if (display.icon !== undefined && typeof display.icon !== 'string') {
    errors.push('display.icon must be a string');
  }
  if (display.color !== undefined && !isColor(display.color)) {
    errors.push(`display.color ${JSON.stringify(display.color)} must be a hex colour like #ff3b6b`);
  }
  if (display.size !== undefined) {
    const size = display.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > MAX_SIZE) {
      errors.push(`display.size must be a number in (0, ${MAX_SIZE}]`);
    }
  }
  if (display.max_visible !== undefined) {
    const mv = display.max_visible;
    if (!Number.isInteger(mv) || (mv as number) < 1 || (mv as number) > MAX_VISIBLE_CEILING) {
      errors.push(`display.max_visible must be an integer in [1, ${MAX_VISIBLE_CEILING}]`);
    }
  }
  if (display.rotate !== undefined && typeof display.rotate !== 'boolean') {
    errors.push('display.rotate must be true or false');
  }
  if (display.ttl !== undefined && display.ttl !== null && parseTtlSeconds(display.ttl) === null) {
    errors.push(
      `display.ttl ${JSON.stringify(display.ttl)} is not a duration (e.g. "90s", "15m", "24h", "7d")`
    );
  }

  const trail = display.trail;
  if (trail !== undefined) {
    if (!isPlainObject(trail)) {
      errors.push('display.trail must be a mapping');
    } else {
      if (trail.enabled !== undefined && typeof trail.enabled !== 'boolean') {
        errors.push('display.trail.enabled must be true or false');
      }
      const mp = trail.max_points;
      if (
        mp !== undefined &&
        (!Number.isInteger(mp) || (mp as number) < 1 || (mp as number) > MAX_TRAIL_POINTS)
      ) {
        errors.push(`display.trail.max_points must be an integer in [1, ${MAX_TRAIL_POINTS}]`);
      }
    }
  }

  const colorBy = display.color_by;
  if (colorBy !== undefined) {
    if (!isPlainObject(colorBy)) {
      errors.push('display.color_by must be a mapping');
    } else {
      if (typeof colorBy.field !== 'string' || colorBy.field.trim() === '') {
        errors.push('display.color_by.field is required');
      }
      const hasStops = colorBy.stops !== undefined;
      const hasMap = colorBy.map !== undefined;
      if (hasStops === hasMap) {
        errors.push('display.color_by needs exactly one of "stops" or "map"');
      }
      if (hasStops) {
        const stops = colorBy.stops;
        const ok =
          Array.isArray(stops) &&
          stops.length > 0 &&
          stops.every(
            (s) =>
              Array.isArray(s) &&
              s.length === 2 &&
              typeof s[0] === 'number' &&
              Number.isFinite(s[0]) &&
              isColor(s[1])
          );
        if (!ok) {
          errors.push('display.color_by.stops must be a list of [number, "#hex"] pairs');
        } else {
          const values = (stops as Array<[number, string]>).map((s) => s[0]);
          if (values.some((v, i) => i > 0 && v <= values[i - 1])) {
            errors.push('display.color_by.stops must be in strictly ascending order');
          }
        }
      }
      if (hasMap) {
        const map = colorBy.map;
        if (!isPlainObject(map) || !Object.values(map).every(isColor)) {
          errors.push('display.color_by.map must map values to "#hex" colours');
        }
      }
      if (colorBy.default !== undefined && !isColor(colorBy.default)) {
        errors.push('display.color_by.default must be a hex colour');
      }
    }
  }

  const fields = display.fields;
  if (fields !== undefined) {
    if (!Array.isArray(fields)) {
      errors.push('display.fields must be a list');
    } else {
      fields.forEach((f, i) => {
        const at = `display.fields[${i}]`;
        if (!isPlainObject(f)) {
          errors.push(`${at} must be a mapping`);
          return;
        }
        if (typeof f.path !== 'string' || f.path.trim() === '') {
          errors.push(`${at}.path is required`);
        }
        if (f.label !== undefined && typeof f.label !== 'string') {
          errors.push(`${at}.label must be a string`);
        }
        if (f.format !== undefined && !(FIELD_FORMATS as readonly unknown[]).includes(f.format)) {
          errors.push(
            `${at}.format ${JSON.stringify(f.format)} is not one of: ${FIELD_FORMATS.join(', ')}`
          );
        }
        if (
          f.precision !== undefined &&
          (!Number.isInteger(f.precision) ||
            (f.precision as number) < 0 ||
            (f.precision as number) > 10)
        ) {
          errors.push(`${at}.precision must be an integer in [0, 10]`);
        }
        for (const key of ['prefix', 'suffix'] as const) {
          if (f[key] !== undefined && typeof f[key] !== 'string') {
            errors.push(`${at}.${key} must be a string`);
          }
        }
      });
    }
  }

  return errors;
}

/**
 * Defaults-applied layer + display for a config that already passed `validateLayerDisplay`.
 * `warn` receives non-fatal problems (unknown icon).
 */
export function resolveLayerDisplay(
  config: Record<string, unknown>,
  warn: (message: string) => void = () => undefined
): { layer: ResolvedLayer; display: ResolvedDisplay } {
  const rawLayer = isPlainObject(config.layer) ? config.layer : {};
  const rawDisplay = isPlainObject(config.display) ? config.display : undefined;
  const d = rawDisplay ?? {};

  const layer: ResolvedLayer = {
    id: typeof rawLayer.id === 'string' ? rawLayer.id : toLayerId(config.layer_type ?? config.name),
    name:
      typeof rawLayer.name === 'string'
        ? rawLayer.name
        : String(config.display_name ?? config.name ?? ''),
    group: (rawLayer.group as LayerGroup | undefined) ?? DEFAULT_GROUP,
    description: typeof rawLayer.description === 'string' ? rawLayer.description : '',
    default_visible: rawLayer.default_visible !== false
  };

  let icon = typeof d.icon === 'string' ? d.icon : DEFAULT_ICON;
  if (!(ICON_KEYS as readonly string[]).includes(icon)) {
    warn(`unknown display.icon "${icon}", using "${DEFAULT_ICON}"`);
    icon = DEFAULT_ICON;
  }

  const trail = isPlainObject(d.trail) ? d.trail : {};
  const ttlSeconds = d.ttl === undefined || d.ttl === null ? null : parseTtlSeconds(d.ttl);

  const display: ResolvedDisplay = {
    declared: rawDisplay !== undefined,
    icon,
    color: typeof d.color === 'string' ? d.color.toLowerCase() : DEFAULT_COLOR,
    size: typeof d.size === 'number' ? d.size : 1,
    rotate: d.rotate === true,
    trail: {
      enabled: trail.enabled === true,
      max_points: typeof trail.max_points === 'number' ? trail.max_points : DEFAULT_TRAIL_POINTS
    },
    ttl: ttlSeconds === null ? null : String(d.ttl),
    ttl_seconds: ttlSeconds,
    max_visible: typeof d.max_visible === 'number' ? d.max_visible : DEFAULT_MAX_VISIBLE,
    fields: Array.isArray(d.fields)
      ? (d.fields as Array<Record<string, unknown>>).map((f) => {
          const field: DisplayField = {
            path: String(f.path),
            label: typeof f.label === 'string' ? f.label : String(f.path),
            format: (f.format as FieldFormat | undefined) ?? 'text'
          };
          if (typeof f.precision === 'number') field.precision = f.precision;
          if (typeof f.prefix === 'string') field.prefix = f.prefix;
          if (typeof f.suffix === 'string') field.suffix = f.suffix;
          return field;
        })
      : []
  };

  if (isPlainObject(d.color_by)) {
    const cb = d.color_by;
    const colorBy: ColorBy = { field: String(cb.field) };
    if (Array.isArray(cb.stops)) {
      colorBy.stops = (cb.stops as Array<[number, string]>).map(([v, c]) => [v, c.toLowerCase()]);
    }
    if (isPlainObject(cb.map)) {
      colorBy.map = Object.fromEntries(
        Object.entries(cb.map).map(([k, c]) => [k, String(c).toLowerCase()])
      );
    }
    if (typeof cb.default === 'string') colorBy.default = cb.default.toLowerCase();
    display.color_by = colorBy;
  }

  return { layer, display };
}
