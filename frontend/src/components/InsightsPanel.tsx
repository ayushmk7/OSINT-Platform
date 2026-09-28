import { useEffect, useMemo, useState, type FC } from 'react';
import { Box, ButtonBase, IconButton, Tooltip } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CloseIcon from '@mui/icons-material/Close';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { useAppDispatch, useAppSelector } from '../store';
import { setSelectedEntityId } from '../store/slices/entitiesSlice';
import {
  ATTENTION_LEVELS,
  requestFlyTo,
  setInsights,
  setInsightStatus,
  type Attention,
  type InsightRecord,
  type InsightStatus
} from '../store/slices/insightsSlice';
import { hud, eyebrow, monoValue } from '../theme';
import { HudPanel } from './HudPrimitives';

/** Chip colour per attention level, low to high urgency. */
export const ATTENTION_COLORS: Record<Attention, string> = {
  info: hud.textSecondary,
  low: '#5ab0ff',
  medium: hud.warning,
  high: '#ff8a3d',
  critical: hud.danger
};

/** "just now", "5m ago", "3h ago", "2d ago". Future timestamps (clock skew) read "just now". */
export function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const AttentionChip: FC<{ level: Attention }> = ({ level }) => {
  const color = ATTENTION_COLORS[level] ?? hud.textSecondary;
  return (
    <Box
      component="span"
      data-attention={level}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        height: 18,
        borderRadius: '9px',
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color,
        bgcolor: `${color}1f`,
        boxShadow: `inset 0 0 0 1px ${color}40`,
        flexShrink: 0
      }}
    >
      <Box component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: color }} />
      {level}
    </Box>
  );
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[insights] ${url} failed:`, err);
    return null;
  }
}

const EmptyState: FC<{ status: InsightStatus | null }> = ({ status }) => {
  if (status && !status.enabled) {
    return (
      <Box sx={{ p: 2, fontSize: '0.8125rem', color: hud.textSecondary, lineHeight: 1.55 }}>
        <Box sx={{ color: hud.textPrimary, fontWeight: 500, mb: 0.75 }}>AI analysis is off</Box>
        Set <Code>ANTHROPIC_API_KEY</Code> in <Code>backend/.env</Code> and restart the backend. For
        OpenAI or a local model (Ollama, LM Studio), set <Code>MKOSINT_LLM_PROVIDER=openai</Code>{' '}
        plus <Code>OPENAI_API_KEY</Code> or <Code>MKOSINT_OPENAI_BASE_URL</Code>. Analyses are
        defined in <Code>analysis.d/</Code>.
        {status.reason && (
          <Box sx={{ ...monoValue, mt: 1, fontSize: '0.6875rem', color: hud.textMuted }}>
            {status.reason}
          </Box>
        )}
      </Box>
    );
  }
  const count = status?.analyses.filter((a) => a.enabled).length ?? 0;
  return (
    <Box sx={{ p: 2, fontSize: '0.8125rem', color: hud.textSecondary, lineHeight: 1.55 }}>
      No insights yet.{' '}
      {status
        ? `${count} ${count === 1 ? 'analysis is' : 'analyses are'} scheduled; results appear here as they run.`
        : 'Waiting for the analysis engine.'}
    </Box>
  );
};

const Code: FC<{ children: string }> = ({ children }) => (
  <Box
    component="code"
    sx={{
      ...monoValue,
      fontSize: '0.75rem',
      color: hud.textPrimary,
      bgcolor: hud.surfaceRaised,
      px: 0.5,
      borderRadius: '4px'
    }}
  >
    {children}
  </Box>
);

const InsightRow: FC<{ insight: InsightRecord; now: number }> = ({ insight, now }) => {
  const dispatch = useAppDispatch();
  const entities = useAppSelector((s) => s.entities.entities);
  const locatable = insight.refs.filter((id) => entities[id]);

  const focus = (id: string) => {
    dispatch(setSelectedEntityId(id));
    dispatch(requestFlyTo(id));
  };

  return (
    <ButtonBase
      component="li"
      onClick={locatable.length > 0 ? () => focus(locatable[0]) : undefined}
      disabled={locatable.length === 0}
      aria-label={`${insight.attention} insight: ${insight.title}`}
      sx={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        px: 1.5,
        py: 1.25,
        borderTop: `1px solid ${hud.hairline}`,
        color: hud.textPrimary,
        '&:hover': { bgcolor: hud.surfaceHover },
        '&.Mui-disabled': { color: hud.textPrimary, cursor: 'default' }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <AttentionChip level={insight.attention} />
        <Box
          component="span"
          sx={{
            ...monoValue,
            fontSize: '0.6875rem',
            color: hud.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1
          }}
        >
          {insight.analysis.replace(/_/g, ' ')}
        </Box>
        <Box
          component="time"
          dateTime={insight.created_at}
          sx={{ ...monoValue, fontSize: '0.6875rem', color: hud.textSecondary, flexShrink: 0 }}
        >
          {formatTimeAgo(insight.created_at, now)}
        </Box>
      </Box>
      <Box sx={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.35 }}>{insight.title}</Box>
      <Box
        sx={{
          mt: 0.25,
          fontSize: '0.75rem',
          color: hud.textSecondary,
          lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
      >
        {insight.summary}
      </Box>
      {locatable.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
          {locatable.slice(0, 4).map((id) => (
            <Box
              key={id}
              component="span"
              role="button"
              tabIndex={0}
              aria-label={`Locate ${entities[id]?.name || id}`}
              onClick={(e) => {
                e.stopPropagation();
                focus(id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  focus(id);
                }
              }}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                maxWidth: 150,
                px: 0.75,
                height: 20,
                borderRadius: '6px',
                fontSize: '0.6875rem',
                color: hud.accent,
                bgcolor: hud.accentSoft,
                cursor: 'pointer',
                '&:hover': { boxShadow: `inset 0 0 0 1px ${hud.accent}66` }
              }}
            >
              <MyLocationIcon sx={{ fontSize: 11 }} />
              <Box
                component="span"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {entities[id]?.name || id}
              </Box>
            </Box>
          ))}
          {locatable.length > 4 && (
            <Box component="span" sx={{ fontSize: '0.6875rem', color: hud.textMuted }}>
              +{locatable.length - 4}
            </Box>
          )}
        </Box>
      )}
    </ButtonBase>
  );
};

export interface InsightsPanelProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * AI insights feed. Loads the latest insights and engine status over REST on mount; live
 * `ai_insight` WebSocket frames land in the same slice via useWebSocket. Clicking an insight
 * selects its first linked entity and asks the globe to fly there; the chips target each
 * linked entity individually. Positioning is owned by the parent (App).
 */
export const InsightsPanel: FC<InsightsPanelProps> = ({ open, onOpen, onClose }) => {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.insights.items);
  const status = useAppSelector((s) => s.insights.status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, st] = await Promise.all([
        getJson<{ insights: InsightRecord[] }>('/api/insights?limit=50'),
        getJson<InsightStatus>('/api/insights/status')
      ]);
      if (cancelled) return;
      if (list?.insights) dispatch(setInsights(list.insights));
      if (st) dispatch(setInsightStatus(st));
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Re-render relative times twice a minute.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const topLevel = useMemo(() => {
    let best = -1;
    for (const i of items) best = Math.max(best, ATTENTION_LEVELS.indexOf(i.attention));
    return best >= 0 ? ATTENTION_LEVELS[best] : null;
  }, [items]);

  if (!open) {
    return (
      <HudPanel sx={{ pointerEvents: 'auto', display: 'inline-flex' }}>
        <ButtonBase
          onClick={onOpen}
          aria-label="open AI insights"
          sx={{
            height: 44,
            px: 1.5,
            gap: 1,
            borderRadius: `${hud.radius}px`,
            color: hud.textPrimary,
            fontSize: '0.8125rem',
            fontWeight: 500
          }}
        >
          <AutoAwesomeOutlinedIcon sx={{ fontSize: 18, color: hud.accent }} />
          Insights
          <Box
            component="span"
            sx={{ ...monoValue, color: hud.textSecondary, fontSize: '0.75rem' }}
          >
            {items.length}
          </Box>
          {topLevel && (
            <Box
              component="span"
              aria-hidden
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                bgcolor: ATTENTION_COLORS[topLevel]
              }}
            />
          )}
        </ButtonBase>
      </HudPanel>
    );
  }

  return (
    <HudPanel
      role="region"
      aria-label="AI insights"
      sx={{
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxHeight: '100%',
        overflow: 'hidden'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 0.5, py: 0.75 }}>
        <AutoAwesomeOutlinedIcon sx={{ fontSize: 16, color: hud.accent }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={eyebrow}>AI insights</Box>
          <Box
            sx={{
              ...monoValue,
              fontSize: '0.6875rem',
              color: hud.textMuted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {status?.enabled ? `${status.provider} · ${status.model}` : status ? 'disabled' : '—'}
          </Box>
        </Box>
        <Tooltip title="Collapse">
          <IconButton size="small" onClick={onClose} aria-label="close AI insights">
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ overflowY: 'auto', minHeight: 0 }}>
        {items.length === 0 ? (
          <EmptyState status={status} />
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {items.map((insight) => (
              <InsightRow key={insight.id} insight={insight} now={now} />
            ))}
          </Box>
        )}
      </Box>
    </HudPanel>
  );
};
