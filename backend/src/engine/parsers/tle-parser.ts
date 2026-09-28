import { IParser, getNestedProperty, toRecordArray } from './types';

/**
 * Orbital element sets. Both formats produce "element records" carrying `line1` / `line2`
 * (a canonical TLE), which `orbit.ts` propagates to lat/lon/alt on every poll and tick.
 *
 *  - `format: tle`      plain-text TLE, 3-line (name / line 1 / line 2, name may be prefixed
 *                       with "0 ") or 2-line (named "NORAD <id>").
 *  - `format: omm_json` CelesTrak GP JSON (OMM keywords: OBJECT_NAME, NORAD_CAT_ID, EPOCH,
 *                       MEAN_MOTION, ...). Each record keeps its OMM fields and gains a
 *                       synthesized TLE so both formats share one propagation path.
 */
export interface ElementRecord {
  name: string;
  norad_id: string;
  intl_designator: string;
  /** ISO-8601 epoch of the element set. */
  epoch: string | null;
  inclination: number;
  eccentricity: number;
  mean_motion: number;
  /** Orbital period in minutes. */
  period_min: number | null;
  line1: string;
  line2: string;
  [key: string]: unknown;
}

function isLine1(l: string | undefined): boolean {
  return !!l && l.startsWith('1 ') && l.length >= 64;
}
function isLine2(l: string | undefined): boolean {
  return !!l && l.startsWith('2 ') && l.length >= 63;
}

/** TLE epoch (2-digit year + fractional day of year) -> ISO string. */
export function tleEpochToIso(line1: string): string | null {
  const yy = parseInt(line1.substring(18, 20), 10);
  const day = parseFloat(line1.substring(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(day)) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const ms = Date.UTC(year, 0, 1) + (day - 1) * 86400000;
  return new Date(ms).toISOString();
}

function elementsFromLines(name: string, line1: string, line2: string): ElementRecord {
  const meanMotion = parseFloat(line2.substring(52, 63));
  return {
    name,
    norad_id: String(parseInt(line1.substring(2, 7), 10) || line1.substring(2, 7).trim()),
    intl_designator: line1.substring(9, 17).trim(),
    epoch: tleEpochToIso(line1),
    inclination: parseFloat(line2.substring(8, 16)),
    eccentricity: parseFloat('.' + line2.substring(26, 33).trim()),
    mean_motion: meanMotion,
    period_min: meanMotion > 0 ? 1440 / meanMotion : null,
    line1,
    line2
  };
}

export const tleParser: IParser = {
  parse(content: string): unknown[] {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== '');
    const out: ElementRecord[] = [];
    for (let i = 0; i < lines.length;) {
      const [a, b, c] = [lines[i], lines[i + 1], lines[i + 2]];
      if (isLine1(a) && isLine2(b)) {
        const rec = elementsFromLines('', a, b);
        rec.name = `NORAD ${rec.norad_id}`;
        out.push(rec);
        i += 2;
      } else if (!isLine1(a) && isLine1(b) && isLine2(c)) {
        out.push(elementsFromLines(a.replace(/^0 /, '').trim(), b, c));
        i += 3;
      } else {
        i++; // stray line (header, truncated set) -> skip
      }
    }
    return out;
  }
};

// ---------------------------------------------------------------------------------------
// OMM (CelesTrak GP JSON) -> canonical TLE lines
// ---------------------------------------------------------------------------------------

/** Mod-10 TLE checksum: digits add their value, '-' adds 1. */
export function tleChecksum(line: string): number {
  let sum = 0;
  for (const ch of line.substring(0, 68)) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return sum % 10;
}

/** TLE "assumed decimal point" exponent field, e.g. 0.00012345 -> " 12345-3". */
function expField(x: number): string {
  if (!Number.isFinite(x) || x === 0) return ' 00000-0';
  const sign = x < 0 ? '-' : ' ';
  let exp = Math.floor(Math.log10(Math.abs(x))) + 1;
  let mantissa = Math.round((Math.abs(x) / 10 ** exp) * 1e5);
  if (mantissa >= 100000) {
    mantissa = Math.round(mantissa / 10);
    exp += 1;
  }
  if (exp > 9 || exp < -9) return ' 00000-0';
  return `${sign}${String(mantissa).padStart(5, '0')}${exp < 0 ? '-' : '+'}${Math.abs(exp)}`;
}

/** First derivative of mean motion: sign + ".dddddddd" (10 chars). */
function ndotField(x: number): string {
  const v = Number.isFinite(x) ? x : 0;
  const digits = Math.abs(v).toFixed(8).replace(/^0/, '');
  return `${v < 0 ? '-' : ' '}${digits}`.padStart(10, ' ').slice(-10);
}

function fixed(x: number, width: number, decimals: number): string {
  return (Number.isFinite(x) ? x : 0).toFixed(decimals).padStart(width, ' ').slice(-width);
}

/** "1998-067A" -> "98067A". */
function intlDesignator(objectId: unknown): string {
  const m = /^(\d{2})(\d{2})-(\d{3})(\w{0,3})$/.exec(String(objectId ?? '').trim());
  return m ? `${m[2]}${m[3]}${m[4]}` : '';
}

/** OMM EPOCH ("2024-01-02T03:04:05.678901", UTC) -> [2-digit year, fractional day of year]. */
function epochParts(epoch: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(epoch);
  if (!m) return null;
  const [year, month, day, h, min] = m.slice(1, 6).map(Number);
  const sec = Number(m[6]);
  const doy = (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000 + 1;
  return [year % 100, doy + (h * 3600 + min * 60 + sec) / 86400];
}

/** Build TLE lines from OMM mean elements; null when mandatory fields are missing. */
export function ommToTle(omm: Record<string, unknown>): { line1: string; line2: string } | null {
  const n = (k: string): number => Number(omm[k]);
  const epoch = epochParts(String(omm.EPOCH ?? ''));
  const required = [
    'NORAD_CAT_ID',
    'MEAN_MOTION',
    'ECCENTRICITY',
    'INCLINATION',
    'RA_OF_ASC_NODE',
    'ARG_OF_PERICENTER',
    'MEAN_ANOMALY'
  ];
  if (!epoch || required.some((k) => !Number.isFinite(n(k)))) return null;

  const satnum = String(Math.trunc(n('NORAD_CAT_ID')) % 100000).padStart(5, '0');
  const cls = String(omm.CLASSIFICATION_TYPE ?? 'U').charAt(0) || 'U';
  const [yy, doy] = epoch;
  const epochField = `${String(yy).padStart(2, '0')}${doy.toFixed(8).padStart(12, '0')}`;
  const elset = String(Math.trunc(n('ELEMENT_SET_NO')) || 999)
    .padStart(4, ' ')
    .slice(-4);

  const body1 =
    `1 ${satnum}${cls} ${intlDesignator(omm.OBJECT_ID).padEnd(8, ' ')} ${epochField} ` +
    `${ndotField(n('MEAN_MOTION_DOT'))} ${expField(n('MEAN_MOTION_DDOT'))} ` +
    `${expField(n('BSTAR'))} 0 ${elset}`;
  const ecc = Math.round(n('ECCENTRICITY') * 1e7)
    .toString()
    .padStart(7, '0')
    .slice(0, 7);
  const rev = String(Math.trunc(n('REV_AT_EPOCH')) || 0)
    .padStart(5, ' ')
    .slice(-5);
  const body2 =
    `2 ${satnum} ${fixed(n('INCLINATION'), 8, 4)} ${fixed(n('RA_OF_ASC_NODE'), 8, 4)} ${ecc} ` +
    `${fixed(n('ARG_OF_PERICENTER'), 8, 4)} ${fixed(n('MEAN_ANOMALY'), 8, 4)} ` +
    `${fixed(n('MEAN_MOTION'), 11, 8)}${rev}`;

  return {
    line1: body1 + tleChecksum(body1),
    line2: body2 + tleChecksum(body2)
  };
}

export const ommJsonParser: IParser = {
  parse(content: string, recordsPath?: string): unknown[] {
    const parsed: unknown = JSON.parse(content);
    const out: ElementRecord[] = [];
    for (const raw of toRecordArray(getNestedProperty(parsed, recordsPath))) {
      if (!raw || typeof raw !== 'object') continue;
      const omm = raw as Record<string, unknown>;
      const lines = ommToTle(omm);
      if (!lines) continue;
      const meanMotion = Number(omm.MEAN_MOTION);
      out.push({
        ...omm,
        name: String(omm.OBJECT_NAME ?? `NORAD ${omm.NORAD_CAT_ID}`).trim(),
        norad_id: String(omm.NORAD_CAT_ID),
        intl_designator: String(omm.OBJECT_ID ?? ''),
        epoch: tleEpochToIso(lines.line1),
        inclination: Number(omm.INCLINATION),
        eccentricity: Number(omm.ECCENTRICITY),
        mean_motion: meanMotion,
        period_min: meanMotion > 0 ? 1440 / meanMotion : null,
        line1: lines.line1,
        line2: lines.line2
      });
    }
    return out;
  }
};
