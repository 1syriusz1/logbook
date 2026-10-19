import { createRoot } from 'react-dom/client';
import { App } from './App';
import { flush, initStore } from './lib/store';
import { initNav } from './lib/nav';
import { onAppPause, registerServiceWorker, requestPersistentStorage } from './lib/platform';
import { demoDB } from './lib/demo';
import './styles/base.css';
import './styles/screens.css';

async function boot() {
  await initStore(import.meta.env.MODE === 'demo' ? () => demoDB() : undefined);
  initNav();
  onAppPause(flush);
  requestPersistentStorage();
  registerServiceWorker();
  createRoot(document.getElementById('root')!).render(<App />);
}

boot();
