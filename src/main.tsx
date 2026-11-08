import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/sora/latin-600.css';
import '@fontsource/sora/latin-700.css';
import '@fontsource/sora/latin-800.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './styles/app.css';
import { App } from './ui/App';
import { init } from './ui/store';
import { initSync } from './ui/sync';
import { registerSW } from 'virtual:pwa-register';
import { initTheme } from './ui/theme';

initTheme(); // vor dem ersten Rendern, sonst blitzt das falsche Schema auf

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void init().then(initSync);

// Service Worker (Offline-Training). Nur in sicheren Kontexten (https/localhost) verfügbar.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}
