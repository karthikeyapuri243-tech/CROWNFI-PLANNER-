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

// Fit mobile sheets to the visible viewport, including the Android soft keyboard.
// Keep this outside React so keyboard resize does not re-render the planner.
const rootStyle=document.documentElement.style;
let viewportFrame=0;
const refreshVisibleViewport=()=>{
  if(viewportFrame)cancelAnimationFrame(viewportFrame);
  viewportFrame=requestAnimationFrame(()=>{
    viewportFrame=0;
    const viewport=window.visualViewport;
    // Do not change the sheet's layout when the user pinch-zooms.
    const useVisual=viewport&&Math.abs(viewport.scale-1)<0.02;
    rootStyle.setProperty('--kram-visible-height',Math.round(useVisual?viewport.height:window.innerHeight)+'px');
    rootStyle.setProperty('--kram-visible-top',Math.max(0,Math.round(useVisual?viewport.offsetTop:0))+'px');
    const focused=document.activeElement;
    const typing=focused instanceof HTMLElement&&focused.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=date]):not([type=time])');
    const card=typing?focused.closest<HTMLElement>('.modal-card'):null;
    document.documentElement.classList.toggle('kram-sheet-input-focused',!!card);
    if(!card||!(focused instanceof HTMLElement)||!window.matchMedia('(max-width:900px)').matches)return;
    const bounds=card.getBoundingClientRect();
    const field=focused.getBoundingClientRect();
    // Scroll only the form, rather than moving the background planner.
    if(field.bottom>bounds.bottom-14)card.scrollTop+=field.bottom-bounds.bottom+14;
    else if(field.top<bounds.top+10)card.scrollTop-=bounds.top+10-field.top;
  });
};
window.addEventListener('resize',refreshVisibleViewport,{passive:true});
window.visualViewport?.addEventListener('resize',refreshVisibleViewport,{passive:true});
window.visualViewport?.addEventListener('scroll',refreshVisibleViewport,{passive:true});
document.addEventListener('focusin',refreshVisibleViewport);
document.addEventListener('focusout',refreshVisibleViewport);
refreshVisibleViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
