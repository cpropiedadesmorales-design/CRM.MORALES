/* Morales & Co. — service worker
   - La página (index.html) siempre se pide primero a internet (así recibes las actualizaciones) y, si no hay red, se abre la copia guardada.
   - Las librerías de Firebase (versión fija) se guardan: la 2ª vez que abres la app cargan al instante.
   - Nunca se guardan ni interceptan los datos de Firebase (Auth/Firestore): siempre salen directo a internet. */
const VERSION = 'mc-v10-pwa1';
const SHELL_CACHE = VERSION + '-shell';
const LIB_CACHE = 'mc-firebase-libs';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const abs = p => new URL(p, self.location).href;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(u => c.add(u).catch(() => { })));   // si falta un archivo no se cancela la instalación
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf('mc-') === 0 && k !== SHELL_CACHE && k !== LIB_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

async function cacheFirst(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(SHELL_CACHE), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || new Response('', { status: 504 });
}

async function networkFirstNav(req) {
  const c = await caches.open(SHELL_CACHE), u = new URL(req.url), key = u.origin + u.pathname;
  const net = fetch(req); let slow = false;
  try {
    const res = await Promise.race([net, new Promise((_, rej) => setTimeout(() => { slow = true; rej(new Error('slow')); }, 4000))]);
    if (res && res.ok) c.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = (await c.match(key)) || (/catalogo\.html$/.test(u.pathname) ? null : await c.match(abs('./index.html')));
    if (hit) { if (slow) net.then(r => { if (r && r.ok) c.put(key, r); }, () => { }); return hit; }
    return net.catch(() => new Response('Sin conexión. Vuelve a intentarlo cuando tengas internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) { e.respondWith(cacheFirst(req, LIB_CACHE)); return; }
  if (url.origin !== self.location.origin) return;                     // Firebase Auth/Firestore y fuentes: directo a internet
  if (req.mode === 'navigate') { e.respondWith(networkFirstNav(req)); return; }
  if (SHELL.some(p => abs(p) === url.href)) e.respondWith(staleWhileRevalidate(req));
});
