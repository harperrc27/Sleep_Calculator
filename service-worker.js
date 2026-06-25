/**
 * Sleep Number Quote Studio — service-worker.js
 * Offline-first caching strategy.
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/manifest): Cache-first, served from cache with background update.
 *  - catalog.json: Network-first (latest data > cached fallback).
 *  - All other GET requests: Network-first with cache fallback.
 */

const CACHE_VERSION = 'snqs-v2';

const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
];

// ── Install: pre-cache the app shell ───────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // catalog.json: network-first so the app always tries to get the latest.
  // Falls back to cache if offline.
  if (url.pathname.endsWith('catalog.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // App shell: cache-first for instant loads, update cache in background.
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache  = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req);
  if (cached) {
    // Update in background
    fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return caches.match('index.html');
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
