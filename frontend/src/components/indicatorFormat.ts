import type { IndicatorPoint, IndicatorRecord } from '../store/slices/feedSlice';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

/**
 * Tile value: compact for millions and up (1.2M), scientific for tiny magnitudes (3.3e-7 X-ray
 * flux), otherwise a precision that suits the magnitude.
 */
export function formatIndicatorValue(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e6) return compact.format(v);
  if (a < 0.01) return v.toExponential(2);
  const digits = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export interface IndicatorChange {
  /** Signed change; `percent` says whether it is a percentage. */
  value: number;
  percent: boolean;
  direction: 'up' | 'down' | 'flat';
}

/**
 * The change to show on a tile: the source's own `change` (treated as a percentage, which is
 * what market feeds report), else the difference between the last two distinct history points.
 */
export function indicatorChange(
  ind: Pick<IndicatorRecord, 'change' | 'history'>
): IndicatorChange | null {
  let value: number;
  let percent: boolean;
  if (typeof ind.change === 'number' && Number.isFinite(ind.change)) {
    value = ind.change;
    percent = true;
  } else {
    const h = ind.history;
    if (h.length < 2) return null;
    value = h[h.length - 1].v - h[h.length - 2].v;
    percent = false;
  }
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return { value, percent, direction };
}

/**
 * "+1.62%" / "−0.33" / "−0.0048". Absolute changes use scientific notation only when the
 * indicator's own value is that small (X-ray flux), else two significant digits.
 */
export function formatChange(c: IndicatorChange, reference?: number): string {
  const sign = c.value > 0 ? '+' : c.value < 0 ? '−' : '';
  const a = Math.abs(c.value);
  let body: string;
  if (c.percent) body = `${a.toFixed(2)}%`;
  else if (a === 0) body = '0';
  else if (reference !== undefined && Math.abs(reference) < 0.01) body = a.toExponential(2);
  else if (a >= 1) body = formatIndicatorValue(a);
  else body = String(Number(a.toPrecision(2)));
  return `${sign}${body}`;
}

/**
 * SVG polyline `points` for a sparkline of `history` inside a width x height box (y grows down).
 * Empty for fewer than two points; a flat series is drawn along the middle.
 */
export function sparklinePoints(history: IndicatorPoint[], width: number, height: number): string {
  if (history.length < 2) return '';
  const vs = history.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min;
  const pad = 1.5;
  return vs
    .map((v, i) => {
      const x = (i / (vs.length - 1)) * width;
      const y = span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
