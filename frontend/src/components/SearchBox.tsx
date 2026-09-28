import { useEffect, useMemo, useRef, useState, type FC, type KeyboardEvent } from 'react';
import { Box, ButtonBase, InputBase, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import { useStore } from 'react-redux';
import { useAppDispatch, type RootState } from '../store';
import { setSelectedEntityId } from '../store/slices/entitiesSlice';
import { requestFlyTo } from '../store/slices/insightsSlice';
import { hud, monoValue } from '../theme';
import { CategoryGlyph, HudPanel } from './HudPrimitives';
import { searchAll, type SearchResult } from './search';

/** Debounce for the (synchronous) search over every loaded entity. */
const SEARCH_DELAY_MS = 120;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Header search over loaded entities (name, id, metadata) and feed titles. Cmd/Ctrl+K focuses
 * it; arrows move, Enter (or a click) selects: entities and located feed items are selected
 * and flown to, other feed items open their link in a new tab.
 */
export const SearchBox: FC = () => {
  const dispatch = useAppDispatch();
  // Read at search / select time rather than subscribing: the entity map changes on every
  // live update and the box should not re-render for each one.
  const store = useStore<RootState>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Results are computed from the debounced query only, so live entity updates between
  // keystrokes do not re-run the search on every frame.
  const results = useMemo(() => {
    const s = store.getState();
    return searchAll(debounced, s.entities.entities, s.sources.sources, s.feed.items);
  }, [debounced, store]);

  useEffect(() => setActive(0), [results]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (r: SearchResult) => {
    const located = r.latitude !== null && r.longitude !== null;
    if (r.kind === 'entity' || located) {
      const entityId = r.entityId ?? r.id;
      if (store.getState().entities.entities[entityId]) dispatch(setSelectedEntityId(entityId));
      dispatch(
        requestFlyTo({
          entityId,
          latitude: r.latitude ?? undefined,
          longitude: r.longitude ?? undefined
        })
      );
    } else if (r.url) {
      window.open(r.url, '_blank', 'noopener,noreferrer');
    }
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const r = results[active];
      if (r) {
        e.preventDefault();
        choose(r);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showList = open && debounced.trim().length >= 2;

  return (
    <Box sx={{ position: 'relative', pointerEvents: 'auto', width: '100%' }}>
      <HudPanel sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, height: 44 }}>
        <SearchIcon sx={{ fontSize: 18, color: hud.textSecondary }} />
        <InputBase
          inputRef={inputRef}
          value={query}
          placeholder={compact ? 'Search' : 'Search entities & feeds'}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          inputProps={{
            'aria-label': 'Search entities and feeds',
            role: 'combobox',
            'aria-expanded': showList,
            'aria-controls': 'mk-search-results',
            'aria-autocomplete': 'list'
          }}
          sx={{ flex: 1, fontSize: '0.8125rem', color: hud.textPrimary, minWidth: 0 }}
        />
        <Box
          component="kbd"
          sx={{
            ...monoValue,
            display: { xs: 'none', md: 'inline-block' },
            fontSize: '0.625rem',
            color: hud.textMuted,
            px: 0.6,
            py: 0.1,
            borderRadius: '5px',
            boxShadow: `inset 0 0 0 1px ${hud.hairlineStrong}`
          }}
        >
          {isMac ? '⌘K' : 'Ctrl K'}
        </Box>
      </HudPanel>
      {showList && (
        <HudPanel
          id="mk-search-results"
          role="listbox"
          aria-label="Search results"
          sx={{
            position: 'absolute',
            top: 50,
            left: 0,
            right: 0,
            maxHeight: '60vh',
            overflowY: 'auto',
            bgcolor: hud.surfaceSolid,
            zIndex: 10,
            py: 0.5
          }}
        >
          {results.length === 0 ? (
            <Box sx={{ px: 1.5, py: 1, fontSize: '0.75rem', color: hud.textSecondary }}>
              No matches
            </Box>
          ) : (
            results.map((r, i) => (
              <ButtonBase
                key={`${r.kind}:${r.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                sx={{
                  display: 'flex',
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  bgcolor: i === active ? hud.surfaceHover : 'transparent'
                }}
              >
                <CategoryGlyph category={r.category} icon={r.icon} color={r.color} size={14} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Box
                    sx={{
                      fontSize: '0.8125rem',
                      color: hud.textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {r.title}
                  </Box>
                  <Box
                    sx={{
                      ...monoValue,
                      fontSize: '0.6875rem',
                      color: hud.textMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {r.kind === 'feed' ? `feed · ${r.subtitle}` : r.subtitle}
                  </Box>
                </Box>
              </ButtonBase>
            ))
          )}
        </HudPanel>
      )}
    </Box>
  );
};
