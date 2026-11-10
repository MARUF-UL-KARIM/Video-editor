import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/caveat';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/playfair-display/wght-italic.css';
import '@fontsource/anton';
import '@fontsource/bebas-neue';
import '@fontsource/archivo-black';
import '@fontsource/bangers';
import '@fontsource/permanent-marker';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
