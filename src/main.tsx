import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PetStateProvider } from './state/PetStateContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetStateProvider>
      <App />
    </PetStateProvider>
  </StrictMode>,
);
