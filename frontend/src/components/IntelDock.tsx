import { useMemo, type FC, type ReactNode } from 'react';
import { Box, ButtonBase, IconButton, Tooltip } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import NewspaperOutlinedIcon from '@mui/icons-material/NewspaperOutlined';
import SsidChartIcon from '@mui/icons-material/SsidChart';
import RemoveIcon from '@mui/icons-material/Remove';
import { useAppSelector } from '../store';
import { ATTENTION_LEVELS, type Attention } from '../store/slices/insightsSlice';
import { hud, monoValue } from '../theme';
import { HudPanel } from './HudPrimitives';
import { ATTENTION_COLORS, InsightsPanel } from './InsightsPanel';
import { FeedPanel } from './FeedPanel';
import { IndicatorsPanel } from './IndicatorsPanel';

export const DOCK_TABS = ['feed', 'indicators', 'insights'] as const;
export type DockTab = (typeof DOCK_TABS)[number];

const TAB_META: Record<DockTab, { label: string; icon: ReactNode }> = {
  feed: { label: 'Feed', icon: <NewspaperOutlinedIcon sx={{ fontSize: 16 }} /> },
  indicators: { label: 'Signals', icon: <SsidChartIcon sx={{ fontSize: 16 }} /> },
  insights: { label: 'AI', icon: <AutoAwesomeOutlinedIcon sx={{ fontSize: 16 }} /> }
};

/** Highest severity among `levels`, or null. */
function topLevel(levels: Attention[]): Attention | null {
  let best = -1;
  for (const l of levels) best = Math.max(best, ATTENTION_LEVELS.indexOf(l));
  return best >= 0 ? ATTENTION_LEVELS[best] : null;
}

/** Per-tab count + most urgent severity, for the tab badges. */
function useTabBadges(): Record<DockTab, { count: number; level: Attention | null }> {
  const feed = useAppSelector((s) => s.feed.items);
  const indicators = useAppSelector((s) => s.feed.indicators);
  const insights = useAppSelector((s) => s.insights.items);
  return useMemo(() => {
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const recent = feed.filter((i) => i.published >= dayAgo).map((i) => i.severity);
    const ind = Object.values(indicators);
    return {
      feed: { count: feed.length, level: topLevel(recent.filter((l) => l !== 'info')) },
      indicators: {
        count: ind.length,
        level: topLevel(ind.map((i) => i.severity).filter((l) => l !== 'info'))
      },
      insights: { count: insights.length, level: topLevel(insights.map((i) => i.attention)) }
    };
  }, [feed, indicators, insights]);
}

const TabButton: FC<{
  tab: DockTab;
  active: boolean;
  badge: { count: number; level: Attention | null };
  onClick: () => void;
}> = ({ tab, active, badge, onClick }) => (
  <ButtonBase
    role="tab"
    aria-selected={active}
    aria-controls={`dock-panel-${tab}`}
    id={`dock-tab-${tab}`}
    onClick={onClick}
    sx={{
      height: 32,
      px: 1,
      gap: 0.6,
      borderRadius: '8px',
      fontSize: '0.75rem',
      fontWeight: 500,
      color: active ? hud.textPrimary : hud.textSecondary,
      bgcolor: active ? hud.surfaceHover : 'transparent',
      boxShadow: active ? `inset 0 0 0 1px ${hud.hairlineStrong}` : 'none',
      '& svg': { color: active ? hud.accent : hud.textSecondary }
    }}
  >
    {TAB_META[tab].icon}
    {TAB_META[tab].label}
    <Box component="span" sx={{ ...monoValue, fontSize: '0.6875rem', color: hud.textMuted }}>
      {badge.count}
    </Box>
    {badge.level && (
      <Box
        component="span"
        aria-label={`${badge.level} severity present`}
        sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ATTENTION_COLORS[badge.level] }}
      />
    )}
  </ButtonBase>
);

export interface IntelDockProps {
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Right-hand intel dock: Feed (news / advisories), Signals (indicator tiles) and AI insights
 * as tabs in one glass panel. Collapsed, it is just the tab strip; clicking a tab opens it.
 * Positioning is owned by the parent (App).
 */
export const IntelDock: FC<IntelDockProps> = ({ tab, onTabChange, open, onOpenChange }) => {
  const badges = useTabBadges();
  return (
    <HudPanel
      role="region"
      aria-label="Intel dock"
      sx={{
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        width: open ? '100%' : 'auto',
        maxWidth: '100%',
        maxHeight: '100%',
        height: open ? '100%' : 'auto',
        overflow: 'hidden'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, p: '6px' }}>
        <Box role="tablist" aria-label="Intel views" sx={{ display: 'flex', gap: 0.25, flex: 1 }}>
          {DOCK_TABS.map((t) => (
            <TabButton
              key={t}
              tab={t}
              active={open && t === tab}
              badge={badges[t]}
              onClick={() => {
                if (open && t === tab) onOpenChange(false);
                else {
                  onTabChange(t);
                  onOpenChange(true);
                }
              }}
            />
          ))}
        </Box>
        {open && (
          <Tooltip title="Collapse">
            <IconButton
              size="small"
              aria-label="collapse intel dock"
              onClick={() => onOpenChange(false)}
            >
              <RemoveIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {/* Every view stays mounted (hidden when inactive or collapsed) so each one loads its
          data once and keeps its filters. */}
      {DOCK_TABS.map((t) => (
        <Box
          key={t}
          role="tabpanel"
          id={`dock-panel-${t}`}
          aria-labelledby={`dock-tab-${t}`}
          hidden={!open || t !== tab}
          sx={{
            display: open && t === tab ? 'flex' : 'none',
            flexDirection: 'column',
            minHeight: 0,
            flex: 1
          }}
        >
          {t === 'feed' && <FeedPanel />}
          {t === 'indicators' && <IndicatorsPanel />}
          {t === 'insights' && (
            <InsightsPanel open embedded onOpen={() => {}} onClose={() => onOpenChange(false)} />
          )}
        </Box>
      ))}
    </HudPanel>
  );
};
