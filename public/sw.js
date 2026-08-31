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

// Bump this on any change to the fetch strategy below, so activate's own
// cleanup evicts everything cached under the old logic instead of mixing
// old and new cache-control decisions.
const CACHE_VERSION = "v2";

// The cache is namespaced per user (v2.0). It used to be one flat
// "finalibaba-v1" bucket, which in multi-user means user B, on the same
// browser as user A, could be served A's cached pages - real financial data,
// out of any session check, since a cache hit never reaches the server. The
// userId comes from the registration query string, the same mechanism (and
// for the same reason) as offlinePages: a static file has no other way to
// learn a server-side fact short of a network round-trip on every install.
// components/layout/service-worker-registration.tsx re-registers whenever it
// changes, so logging in as someone else lands on a different bucket.
let cacheName = `finalibaba-${CACHE_VERSION}-anon`;

function readParams() {
  const params = new URL(self.location.href).searchParams;
  offlinePagesEnabled = params.get("offlinePages") === "1";
  cacheName = `finalibaba-${CACHE_VERSION}-${params.get("u") || "anon"}`;
}

// Both lifecycle events read the params: `install` only fires for a
// genuinely new script URL, but `activate` fires on every worker startup, so
// a page reloaded long after install still resolves the right bucket.
self.addEventListener("install", () => {
  readParams();
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  readParams();
  event.waitUntil(
    caches
      .keys()
      // Drops every bucket but this user's own - so switching accounts on a
      // shared browser evicts the previous user's cached pages rather than
      // leaving them sitting in Cache Storage.
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
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

  // With offline pages disabled there is nothing useful to do here, so this
  // does not intercept at all - it lets the browser make the request itself.
  //
  // The previous version called fetch() and returned whatever came back, on
  // the theory that caching successful responses made repeat visits faster.
  // It did not: nothing ever reads those entries, since only cacheFirst
  // (_next/static) and networkFirstWithFallback (offline pages on) consult
  // the cache. So it was a cache nobody read, and it broke real page loads.
  //
  // Once respondWith has been called the service worker owns the response,
  // and a fetch() that rejects becomes a hard network error the browser
  // cannot recover from - which is exactly what happened in production
  // behind Cloudflare Access. An expired Access session answers a navigation
  // with a cross-origin redirect to the login host; this file is served with
  // the app's own `connect-src 'self'` CSP, so following it from inside the
  // worker is blocked, fetch() rejects, and the page fails with "the promise
  // was rejected" until a manual refresh. Not intercepting means the browser
  // follows that redirect at the top level, where it is perfectly allowed.
  if (!offlinePagesEnabled) return;

  event.respondWith(networkFirstWithFallback(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("offline and not cached");
  }
}

// Web Push (Settings -> "Alertes") - a 3rd alert channel alongside ntfy/
// email, see lib/services/notifications.ts's sendWebPush(). The payload is
// the plain { title, body } JSON dispatchAlert already builds for every
// other channel - no separate formatting needed here.
self.addEventListener("push", (event) => {
  let data = { title: "Finalibaba", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Malformed/non-JSON payload - fall back to the generic title above
    // rather than dropping the notification entirely.
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icon-512",
        badge: "/icon-512",
        tag: "finalibaba-alert",
      }),
      // A dot on the installed app icon, cleared when the app is next opened
      // (see components/layout/service-worker-registration.tsx). Called with no
      // argument on purpose: that means "something is waiting" without a count,
      // which is all this app can honestly claim - it dispatches alerts but
      // stores no read/unread state, so any number here would be invented.
      //
      // Supported on iOS 16.4+ for home-screen web apps, the same gate Web Push
      // already requires, and on desktop Chrome/Edge. Android shows its own
      // badge for unread notifications and ignores this. Feature-detected
      // because the API is absent in Firefox and in a plain browser tab.
      setBadge(),
    ])
  );
});

function setBadge() {
  return self.navigator?.setAppBadge
    ? self.navigator.setAppBadge().catch(() => {})
    : Promise.resolve();
}

// Focuses an already-open tab instead of always opening a new one - a
// user tapping the notification almost certainly already has the PWA
// open somewhere (this app's own auto-sync/offline-banner run in it
// continuously), and a second tab would just be a duplicate, unsynced view.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow("/");
    })
  );
});
