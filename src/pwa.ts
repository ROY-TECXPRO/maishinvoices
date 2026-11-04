/**
 * PWA service-worker registration. The worker only caches static application
 * assets (see public/sw.js); authenticated API responses are never cached.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (import.meta.env.MODE === 'test') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline shell unavailable (e.g. file:// or unsupported browser) - the app still works online.
    });
  });
}
