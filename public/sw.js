// Finalibaba service worker - runtime caching only, no precache manifest.
// Every route in this app is dynamic/server-rendered (see CLAUDE.md's route
// table under "File layout" - almost nothing is static), so there is no
// build-time HTML to precache; instead this caches whatever the browser
// actually requests as it browses, the same "cache what you've seen" model
// as the browser's own disk cache, just surviving offline too.
//
// Registered by components/layout/service-worker-registration.tsx as
// `/sw.js?offlinePages=0|1` - the query string is the only way a static
// file like this one can know AUTH_ENABLED (a server-only env var) without
// a network round-trip on every install. `offlinePages=1` (AUTH_ENABLED
// is not "true" - the documented default, private-network trust model)
// additionally falls back to a cached copy of a page when the network is
// down. `offlinePages=0` (AUTH_ENABLED=true) never does that: falling back
// to a cached authenticated page on network failure would bypass the
// server-side session check that page normally goes through on every
// load - a session can expire (30d JWT, see lib/auth.ts) or be revoked
// server-side without this service worker ever finding out if it's just
// replaying a stale cached response instead of hitting the network. Static,
// content-hashed build assets (_next/static/*) are always cache-first
// either way - genuinely immutable per build, no session/data-sensitivity
// concern at all.
let offlinePagesEnabled = false;

self.addEventListener("install", () => {
  offlinePagesEnabled = new URL(self.location.href).searchParams.get("offlinePages") === "1";
  self.skipWaiting();
});

// Bump this on any change to the fetch strategy below, so activate's own
// cleanup evicts everything cached under the old logic instead of mixing
// old and new cache-control decisions.
const CACHE_NAME = "finalibaba-v1";

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Server Actions POST to the same URL as the page that calls them - method
  // must be checked before anything else, a mutation must never be served
  // from or absorbed into the cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache anything API-shaped: /api/auth (session-sensitive),
  // /api/alerts /api/backup /api/gocardless (all mutate or carry
  // credentials-adjacent data), /api/health (meaningless to cache).
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(offlinePagesEnabled ? networkFirstWithFallback(request) : networkOnlyButCache(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("offline and not cached");
  }
}

// AUTH_ENABLED=true path: still caches successful responses (so a repeat
// visit loads faster once the network round-trip - and its session check -
// has actually happened), but never reads from the cache to answer a
// request that failed. A network failure here surfaces as a normal
// connection error, exactly what would happen without this service worker
// at all.
async function networkOnlyButCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}
