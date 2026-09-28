import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

/**
 * Resolve a source's top-level `lookups:` block into in-memory tables for the `lookup()`
 * expression helper. Each entry is either an inline map or a path (relative to the sources
 * directory, which it may not escape) to:
 *   - a `.json` file holding an object map, or
 *   - a `.csv` file with a header row: the first column is the key; with exactly two columns
 *     the second column is the value, with more the value is the whole row object.
 * Throws with a descriptive message when a table cannot be loaded.
 */
export function resolveLookups(
  lookups: unknown,
  baseDir: string
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (lookups === undefined || lookups === null) return out;
  if (typeof lookups !== 'object' || Array.isArray(lookups)) {
    throw new Error('lookups must be a mapping of name -> map or file path');
  }

  for (const [name, spec] of Object.entries(lookups)) {
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      out[name] = spec as Record<string, unknown>;
      continue;
    }
    if (typeof spec !== 'string' || spec.trim() === '') {
      throw new Error(`lookups.${name} must be an inline map or a file path`);
    }
    out[name] = loadLookupFile(name, spec, baseDir);
  }
  return out;
}

function loadLookupFile(name: string, file: string, baseDir: string): Record<string, unknown> {
  const root = path.resolve(baseDir);
  const full = path.resolve(root, file);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`lookups.${name}: path "${file}" escapes the sources directory`);
  }
  if (!fs.existsSync(full)) {
    throw new Error(`lookups.${name}: file "${file}" not found`);
  }
  const content = fs.readFileSync(full, 'utf8');
  const ext = path.extname(full).toLowerCase();

  if (ext === '.json') {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`lookups.${name}: "${file}" must contain a JSON object`);
    }
    return parsed as Record<string, unknown>;
  }

  if (ext === '.csv') {
    const result = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true
    });
    const fields = result.meta.fields ?? [];
    if (fields.length < 2) {
      throw new Error(`lookups.${name}: "${file}" needs at least two columns`);
    }
    const table: Record<string, unknown> = {};
    for (const row of result.data) {
      const key = row[fields[0]];
      if (key === undefined || key === '') continue;
      table[String(key).trim()] = fields.length === 2 ? row[fields[1]] : row;
    }
    return table;
  }

  throw new Error(`lookups.${name}: unsupported file type "${ext}" (use .json or .csv)`);
}
