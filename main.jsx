import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import large from './data/jiraMockLarge.js';
import small from './data/jiraMock.js';

// Demo data: 4 teams of 3–4 people by default. Add ?data=small to the URL
// to load the small test fixture instead.
const data = new URLSearchParams(window.location.search).get('data') === 'small' ? small : large;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App data={data} />
  </StrictMode>,
);
