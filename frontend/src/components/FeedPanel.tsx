import { memo, useEffect, useMemo, useState, useSyncExternalStore, type FC } from 'react';
import { Box, ButtonBase, IconButton } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector, type RootState } from '../store';
import { setSelectedEntityId } from '../store/slices/entitiesSlice';
import { requestFlyTo } from '../store/slices/insightsSlice';
import { mergeFeedItems, type FeedItemRecord } from '../store/slices/feedSlice';
import type { SourceRecord } from '../store/slices/sourcesSlice';
import { hud, monoValue } from '../theme';
import { ATTENTION_COLORS, formatTimeAgo } from './InsightsPanel';

/** Rows rendered per page ("Show more" adds another); the rest stay in the store. */
export const FEED_PAGE = 50;

export function sourceLabel(src: SourceRecord | undefined, fallback: string): string {
  return src?.name || src?.layer?.name || fallback;
}

/** Ask the globe to fly to a located feed item and open its entity card when it is loaded. */
export function useFocusFeedItem(): (item: FeedItemRecord) => void {
  const dispatch = useAppDispatch();
  // Read entities at click time: subscribing every row to the entity map would re-render the
  // whole feed on every live entity_update.
  const store = useStore<RootState>();
  return (item) => {
    if (item.latitude === null || item.longitude === null) return;
    const entityId = item.entity_id ?? item.id;
    if (store.getState().entities.entities[entityId]) dispatch(setSelectedEntityId(entityId));
    dispatch(requestFlyTo({ entityId, latitude: item.latitude, longitude: item.longitude }));
  };
}

const SourceChip: FC<{
  label: string;
  color: string;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ label, color, count, active, onClick }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={active}
    sx={{
      flexShrink: 0,
      height: 24,
      px: 1,
      gap: 0.5,
      borderRadius: '12px',
      fontSize: '0.6875rem',
      fontWeight: 500,
      color: active ? hud.textPrimary : hud.textSecondary,
      bgcolor: active ? `${color}26` : hud.surfaceRaised,
      boxShadow: `inset 0 0 0 1px ${active ? `${color}80` : hud.hairline}`,
      whiteSpace: 'nowrap'
    }}
  >
    <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
    {label}
    <Box component="span" sx={{ ...monoValue, color: hud.textMuted }}>
      {count}
    </Box>
  </ButtonBase>
);

/** One shared 30 s clock for every row's time-ago label (one timer, however many rows). */
const clock = {
  now: Date.now(),
  listeners: new Set<() => void>(),
  timer: undefined as ReturnType<typeof setInterval> | undefined
};
function subscribeClock(listener: () => void): () => void {
  clock.listeners.add(listener);
  clock.timer ??= setInterval(() => {
    clock.now = Date.now();
    clock.listeners.forEach((l) => l());
  }, 30_000);
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0 && clock.timer) {
      clearInterval(clock.timer);
      clock.timer = undefined;
    }
  };
}

/**
 * Time-ago label. Only this tiny element re-renders when the clock ticks; the (memoised) rows
 * around it do not.
 */
const TimeAgo: FC<{ iso: string }> = ({ iso }) => {
  // Subscribing re-renders this label on every tick; the value itself is read below.
  useSyncExternalStore(subscribeClock, () => clock.now);
  return (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString()}
      style={{
        fontFamily: hud.fontMono,
        fontVariantNumeric: 'tabular-nums',
        fontSize: '0.6875rem',
        color: hud.textMuted,
        flexShrink: 0
      }}
    >
      {formatTimeAgo(iso)}
    </time>
  );
};

const FeedRow = memo(function FeedRow({
  item,
  source
}: {
  item: FeedItemRecord;
  source?: SourceRecord;
}) {
  const focus = useFocusFeedItem();
  const located = item.latitude !== null && item.longitude !== null;
  const sevColor = ATTENTION_COLORS[item.severity] ?? hud.textSecondary;
  return (
    <Box
      component="li"
      data-severity={item.severity}
      onClick={located ? () => focus(item) : undefined}
      sx={{
        position: 'relative',
        px: 1.5,
        py: 1,
        pl: 2,
        borderTop: `1px solid ${hud.hairline}`,
        cursor: located ? 'pointer' : 'default',
        '&:hover': { bgcolor: hud.surfaceHover },
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 6,
          top: 12,
          bottom: 12,
          width: 3,
          borderRadius: 2,
          bgcolor: item.severity === 'info' ? hud.hairlineStrong : sevColor
        }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25, minWidth: 0 }}>
        <Box
          component="span"
          sx={{
            fontSize: '0.6875rem',
            color: source?.display?.color ?? hud.textSecondary,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0
          }}
        >
          {sourceLabel(source, item.source_id)}
        </Box>
        {item.severity !== 'info' && (
          <Box
            component="span"
            sx={{
              fontSize: '0.5625rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: sevColor,
              flexShrink: 0
            }}
          >
            {item.severity}
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <TimeAgo iso={item.published} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {item.url ? (
            <Box
              component="a"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              sx={{
                color: hud.textPrimary,
                textDecoration: 'none',
                fontSize: '0.8125rem',
                fontWeight: 600,
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                '&:hover': { textDecoration: 'underline' }
              }}
            >
              {item.title}
            </Box>
          ) : (
            <Box sx={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.35 }}>
              {item.title}
            </Box>
          )}
          {item.summary && (
            <Box
              sx={{
                mt: 0.25,
                fontSize: '0.72rem',
                color: hud.textSecondary,
                lineHeight: 1.45,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}
            >
              {item.summary}
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', flexShrink: 0, mt: '-2px' }}>
          {located && (
            <IconButton
              title="Fly to"
              size="small"
              aria-label={`Locate ${item.title}`}
              onClick={(e) => {
                e.stopPropagation();
                focus(item);
              }}
              sx={{ color: hud.accent, p: '3px' }}
            >
              <MyLocationIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
          {item.url && (
            <IconButton
              title="Open source"
              size="small"
              component="a"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${item.title} in a new tab`}
              onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}
              sx={{ color: hud.textMuted, p: '3px' }}
            >
              <OpenInNewIcon sx={{ fontSize: 13 }} />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
});

/**
 * News / advisory feed from `kind: feed` sources. The newest items arrive in `initial_state`
 * and as live `feed_item` frames; a larger page is fetched over REST on mount. Source chips
 * filter the list (none selected = all).
 */
export const FeedPanel: FC = () => {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.feed.items);
  const sources = useAppSelector((s) => s.sources.sources);
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState(FEED_PAGE);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/feed?limit=300');
        if (!res.ok) return;
        const body = (await res.json()) as { items?: FeedItemRecord[] };
        if (!cancelled && Array.isArray(body.items)) dispatch(mergeFeedItems(body.items));
      } catch (err) {
        console.warn('[feed] GET /api/feed failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.source_id] = (c[i.source_id] ?? 0) + 1;
    return c;
  }, [items]);
  const chipIds = useMemo(
    () =>
      Object.keys(counts).sort((a, b) =>
        sourceLabel(sources[a], a).localeCompare(sourceLabel(sources[b], b))
      ),
    [counts, sources]
  );
  const filtered = useMemo(() => {
    const set = new Set(selected);
    return set.size === 0 ? items : items.filter((i) => set.has(i.source_id));
  }, [items, selected]);
  const visible = filtered.slice(0, limit);

  const toggle = (id: string) => {
    setLimit(FEED_PAGE);
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {chipIds.length > 0 && (
        <Box
          role="group"
          aria-label="Filter feed by source"
          sx={{
            display: 'flex',
            gap: 0.5,
            px: 1.5,
            pb: 1,
            overflowX: 'auto',
            flexShrink: 0,
            '&::-webkit-scrollbar': { height: 4 }
          }}
        >
          <SourceChip
            label="All"
            color={hud.accent}
            count={items.length}
            active={selected.length === 0}
            onClick={() => setSelected([])}
          />
          {chipIds.map((id) => (
            <SourceChip
              key={id}
              label={sourceLabel(sources[id], id)}
              color={sources[id]?.display?.color ?? hud.textSecondary}
              count={counts[id]}
              active={selected.includes(id)}
              onClick={() => toggle(id)}
            />
          ))}
        </Box>
      )}
      <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {visible.length === 0 ? (
          <Box sx={{ p: 2, fontSize: '0.8125rem', color: hud.textSecondary, lineHeight: 1.55 }}>
            No feed items yet. Feeds are defined in <code>sources.d/</code> with{' '}
            <code>kind: feed</code> and appear here as they are polled.
          </Box>
        ) : (
          <Box component="ul" aria-label="Feed items" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {visible.map((item) => (
              <FeedRow key={item.id} item={item} source={sources[item.source_id]} />
            ))}
          </Box>
        )}
        {filtered.length > visible.length && (
          <ButtonBase
            onClick={() => setLimit((n) => n + FEED_PAGE)}
            sx={{
              width: '100%',
              py: 1,
              fontSize: '0.75rem',
              color: hud.accent,
              borderTop: `1px solid ${hud.hairline}`
            }}
          >
            Show more ({filtered.length - visible.length})
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
};
