import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { store } from './store';
import { tacticalTheme } from './theme';
import { App } from './App';
import { loadRuntimeConfig } from './runtimeConfig';

// Runtime settings (/config.json) are applied BEFORE the first render so the Cesium ion token is
// set before the Viewer is created. loadRuntimeConfig never rejects and times out after 3s.
void loadRuntimeConfig(store.dispatch).then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider theme={tacticalTheme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </Provider>
    </React.StrictMode>
  )
);
