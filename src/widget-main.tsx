import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import CaptureWidget from './components/CaptureWidget.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CaptureWidget />
  </StrictMode>,
);
