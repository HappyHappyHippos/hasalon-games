import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/rubik';
import '@fontsource-variable/inter';
import { App } from './App';
import { dirFor } from './i18n';
import { useStore } from './store';
import { installCrashReporting } from './analytics';
import './ui/tokens.css';
import './ui/styles.css';

// Before the first render, not in an effect.
//
// `index.html` ships `lang="he" dir="rtl"`, which is right for the default and
// wrong for anyone who has switched to English — and an effect runs after React
// has already committed, so those users would get a frame of mirrored layout on
// every load. The store has read localStorage by the time this module body
// runs, so the document can be corrected before anything paints. `App` keeps
// its effect for changes made while the page is open.
const lang = useStore.getState().lang;
document.documentElement.lang = lang;
document.documentElement.dir = dirFor(lang);

// Before the first render, so an error thrown while mounting is still caught.
// The reports queue until the socket opens, which it does moments later.
installCrashReporting();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
