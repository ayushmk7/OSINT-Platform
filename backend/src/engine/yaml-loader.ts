import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export interface SourceConfig {
  schema_version?: number;
  name: string;
  source_type: string;
  layer_type: string;
  display_name: string;
  enabled?: boolean;
  transport: {
    type: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    timeout?: string | number;
    interval: string | number;
    retry?: {
      max_attempts?: number;
      backoff?: string;
      initial_delay?: string;
      max_delay?: string;
    };
  };
  parser: {
    format: 'json' | 'geojson' | 'xml' | 'csv';
    records_path?: string;
    max_records?: number;
  };
  entity: {
    external_id: string;
    name: string;
    category?: string;
    metadata?: Record<string, string>;
  };
  observation: {
    latitude: string;
    longitude: string;
    altitude?: string;
    speed?: string;
    heading?: string;
    timestamp?: string;
  };
  recording?: {
    mode?: 'upsert' | 'append';
  };
}

/**
 * Parse a duration expressed as "30s" / "5m" / "1h" / a bare number of seconds
 * into whole seconds. Returns `fallback` when the value is absent or unusable.
 */
export function parseDurationSeconds(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : fallback;

  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/i.exec(value);
  if (!match) return fallback;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;

  switch ((match[2] || 's').toLowerCase()) {
    case 'ms':
      return Math.max(1, Math.round(amount / 1000));
    case 'm':
      return Math.round(amount * 60);
    case 'h':
      return Math.round(amount * 3600);
    default:
      return Math.round(amount);
  }
}

/** Reject configs that would blow up further down the pipeline. */
function isValidConfig(config: unknown): config is SourceConfig {
  const candidate = config as SourceConfig | null;
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.name === 'string' &&
    candidate.transport &&
    typeof candidate.transport.url === 'string' &&
    candidate.parser &&
    typeof candidate.parser.format === 'string' &&
    candidate.entity &&
    typeof candidate.entity.external_id === 'string' &&
    candidate.observation &&
    typeof candidate.observation.latitude === 'string' &&
    typeof candidate.observation.longitude === 'string'
  );
}

/**
 * Discover every `*.yaml` / `*.yml` source definition in `dirPath`.
 * A malformed or incomplete file is logged and skipped; it never aborts the load.
 */
export function loadSourcesFromDir(dirPath: string): SourceConfig[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath).sort();
  const configs: SourceConfig[] = [];

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

    const filePath = path.join(dirPath, file);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsed = YAML.parse(fileContent);
      if (isValidConfig(parsed)) {
        configs.push(parsed);
      } else {
        console.warn(`Skipping invalid source definition (missing required fields): ${filePath}`);
      }
    } catch (err) {
      console.error(`Failed to parse source definition ${filePath}:`, err);
    }
  }

  return configs;
}
