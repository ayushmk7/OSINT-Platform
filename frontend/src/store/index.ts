import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import entitiesReducer from './slices/entitiesSlice';
import sourcesReducer from './slices/sourcesSlice';
import filterReducer from './slices/filterSlice';
import insightsReducer from './slices/insightsSlice';
import feedReducer from './slices/feedSlice';
import { osintApi } from './api/osintApi';

export const store = configureStore({
  reducer: {
    entities: entitiesReducer,
    sources: sourcesReducer,
    filter: filterReducer,
    insights: insightsReducer,
    feed: feedReducer,
    [osintApi.reducerPath]: osintApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(osintApi.middleware)
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks — every component (and step 5) imports these from '../store'.
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
