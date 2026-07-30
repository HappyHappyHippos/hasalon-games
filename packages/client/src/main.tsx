import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/rubik';
import '@fontsource-variable/inter';
import { App } from './App';
import './ui/tokens.css';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
