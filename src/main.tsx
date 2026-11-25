import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Capacitor} from '@capacitor/core';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Keep the PWA service worker on the website only. On Android, an old worker
// can serve stale JavaScript from its cache even after a newer APK is installed.
if (Capacitor.isNativePlatform()) {
  if ('serviceWorker' in navigator) {
    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const hadWorker = registrations.length > 0;
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      }
      if (hadWorker && navigator.serviceWorker.controller && !sessionStorage.getItem('kram-native-worker-cleared')) {
        sessionStorage.setItem('kram-native-worker-cleared', '1');
        window.location.reload();
      }
    })().catch((error) => console.warn('KRAM native cache cleanup failed:', error));
  }
} else {
  registerSW({immediate: true});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
