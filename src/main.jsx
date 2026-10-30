import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import large from './data/large.js';
import small from './data/small.js';
import './styles.css';

const which = new URLSearchParams(window.location.search).get('data');
const fixture = which === 'small' ? small : large;
const zoom = new URLSearchParams(window.location.search).get('zoom') ?? 'ticket'; // stage 6 adds a control

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App fixture={fixture} initialZoom={zoom} />
  </StrictMode>,
);
