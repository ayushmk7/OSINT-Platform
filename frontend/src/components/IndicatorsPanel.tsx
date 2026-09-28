import { useEffect, useMemo, type FC } from 'react';
import { Box, Tooltip } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../store';
import { setIndicators, type IndicatorRecord } from '../store/slices/feedSlice';
import type { SourceRecord } from '../store/slices/sourcesSlice';
import { hud, eyebrow, monoValue } from '../theme';
import { ATTENTION_COLORS, formatTimeAgo } from './InsightsPanel';
import { LEGEND_GROUP_ORDER } from './legend';
import {
  formatChange,
  formatIndicatorValue,
  indicatorChange,
  sparklinePoints
} from './indicatorFormat';

const SPARK_W = 120;
const SPARK_H = 22;
const UP = '#3ee6a8';
const DOWN = '#ff5c7a';

export interface IndicatorGroup {
  name: string;
  indicators: IndicatorRecord[];
}

/** Indicators grouped by their source's `layer.group` (legend order), then by label. */
export function groupIndicators(
  indicators: Record<string, IndicatorRecord>,
  sources: Record<string, SourceRecord>
): IndicatorGroup[] {
  const groups = new Map<string, IndicatorRecord[]>();
  for (const ind of Object.values(indicators)) {
    const name = sources[ind.source_id]?.layer?.group ?? 'Other';
    const list = groups.get(name) ?? [];
    list.push(ind);
    groups.set(name, list);
  }
  const rank = (n: string) => {
    const i = LEGEND_GROUP_ORDER.indexOf(n);
    return i === -1 ? LEGEND_GROUP_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, list]) => ({
      name,
      indicators: list.sort((a, b) => a.label.localeCompare(b.label))
    }));
}

export const IndicatorTile: FC<{ indicator: IndicatorRecord; source?: SourceRecord }> = ({
  indicator,
  source
}) => {
  const change = indicatorChange(indicator);
  const sev = ATTENTION_COLORS[indicator.severity] ?? hud.textSecondary;
  const alarming = indicator.severity !== 'info';
  const lineColor = alarming ? sev : (source?.display?.color ?? hud.accent);
  const points = sparklinePoints(indicator.history, SPARK_W, SPARK_H);
  const changeColor =
    change?.direction === 'up' ? UP : change?.direction === 'down' ? DOWN : hud.textMuted;
  return (
    <Box
      role="group"
      aria-label={`${indicator.label}: ${formatIndicatorValue(indicator.value)}${indicator.unit ? ` ${indicator.unit}` : ''}`}
      data-severity={indicator.severity}
      sx={{
        minWidth: 0,
        p: 1,
        borderRadius: '10px',
        bgcolor: alarming ? `${sev}14` : hud.surfaceRaised,
        boxShadow: `inset 0 0 0 1px ${alarming ? `${sev}55` : hud.hairline}`
      }}
    >
      <Tooltip
        title={`${source?.name ?? indicator.source_id} · updated ${formatTimeAgo(indicator.updated_at)}`}
      >
        <Box
          sx={{
            ...eyebrow,
            letterSpacing: '0.06em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {indicator.label}
        </Box>
      </Tooltip>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.5, minWidth: 0 }}>
        <Box
          sx={{
            ...monoValue,
            fontSize: '1rem',
            fontWeight: 600,
            color: alarming ? sev : hud.textPrimary,
            whiteSpace: 'nowrap'
          }}
        >
          {formatIndicatorValue(indicator.value)}
        </Box>
        {indicator.unit && (
          <Box
            component="span"
            sx={{
              fontSize: '0.6875rem',
              color: hud.textMuted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {indicator.unit}
          </Box>
        )}
      </Box>
      <Box
        sx={{
          ...monoValue,
          fontSize: '0.6875rem',
          color: changeColor,
          minHeight: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 0.25
        }}
      >
        {change && (
          <>
            <Box component="span" aria-hidden>
              {change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '■'}
            </Box>
            <span data-testid="indicator-change">{formatChange(change, indicator.value)}</span>
          </>
        )}
      </Box>
      {points && (
        <Box
          component="svg"
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          aria-hidden
          sx={{ display: 'block', width: '100%', height: SPARK_H, mt: 0.25 }}
        >
          <polyline
            points={points}
            fill="none"
            stroke={lineColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </Box>
      )}
    </Box>
  );
};

/**
 * Compact tiles for every `kind: indicator` reading, grouped by source layer group. Seeded by
 * `initial_state` and refreshed over REST on mount; live `indicator_update` frames keep it current.
 */
export const IndicatorsPanel: FC = () => {
  const dispatch = useAppDispatch();
  const indicators = useAppSelector((s) => s.feed.indicators);
  const sources = useAppSelector((s) => s.sources.sources);
  const groups = useMemo(() => groupIndicators(indicators, sources), [indicators, sources]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/indicators');
        if (!res.ok) return;
        const body = (await res.json()) as { indicators?: IndicatorRecord[] };
        if (!cancelled && Array.isArray(body.indicators)) {
          dispatch(setIndicators(body.indicators));
        }
      } catch (err) {
        console.warn('[indicators] GET /api/indicators failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  if (groups.length === 0) {
    return (
      <Box sx={{ p: 2, fontSize: '0.8125rem', color: hud.textSecondary, lineHeight: 1.55 }}>
        No indicators yet. Sources with <code>kind: indicator</code> in <code>sources.d/</code> show
        up here once polled.
      </Box>
    );
  }

  return (
    <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1, px: 1.5, pb: 1.5 }}>
      {groups.map((g) => (
        <Box key={g.name} component="section" aria-label={`${g.name} indicators`} sx={{ mb: 1.25 }}>
          <Box sx={{ ...eyebrow, mb: 0.75, color: hud.textMuted }}>{g.name}</Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 0.75
            }}
          >
            {g.indicators.map((ind) => (
              <IndicatorTile key={ind.id} indicator={ind} source={sources[ind.source_id]} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
};
