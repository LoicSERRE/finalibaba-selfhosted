import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SidebarWrapper } from "@/components/layout/sidebar-wrapper";
import { AutoSync } from "@/components/layout/auto-sync";
import { ServiceWorkerRegistration } from "@/components/layout/service-worker-registration";
import { MainContent } from "@/components/layout/main-content";
import { SessionEnded } from "@/components/auth/session-ended";
import { AppLockGate } from "@/components/layout/app-lock-gate";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { prisma } from "@/lib/db/prisma";
import { getViewer, isDeletedSessionUser } from "@/lib/auth-context";
import { resolveThemePreference } from "@/lib/domain/theme";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  // 300 was loaded and preloaded but never used - grep finds no font-light
  // anywhere - so every page paid for a font file it would never draw with,
  // and the browser warned about it ("preloaded but not used within a few
  // seconds from the window's load event").
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  // Used by a handful of components (a code input, a couple of tabular
  // figures), so most pages never draw with it. Preloading it there is the
  // same wasted request, and the same warning. It still loads normally on the
  // pages that do use it.
  preload: false,
});

export const metadata: Metadata = {
  title: "Finalibaba",
  description: "Your wealth, at a glance",
  // No `manifest:` entry: the tag is rendered by hand in <head> below so it
  // can carry crossOrigin. See app/site.webmanifest/route.ts.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Finalibaba",
  },
};

// Static width/initialScale/themeColor + dynamic colorScheme (from the
// THEME cookie - see lib/actions/theme.ts) can't be split across a static
// `viewport` export and a `generateViewport()` one; Next only allows one or
// the other per segment. The whole root layout already reads cookies() for
// locale (i18n/request.ts) and is fully dynamic per request regardless
// (see CLAUDE.md's route table - almost nothing in this app is `○` static),
// so making viewport async here doesn't introduce a new blocking cost.
export async function generateViewport(): Promise<Viewport> {
  const theme = resolveThemePreference((await cookies()).get("THEME")?.value);
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: "#6366f1",
    // "light dark" (not a single fixed value) tells the browser it can
    // pick either at its own discretion for native UI (scrollbars, form
    // controls) - the only way those follow an OS theme change live too,
    // not just this app's own CSS tokens (globals.css's own
    // @media(prefers-color-scheme) block).
    colorScheme: theme === "auto" ? "light dark" : theme,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = resolveThemePreference((await cookies()).get("THEME")?.value);
  // Skipped entirely in demo mode - no real device-pairing story for a
  // public demo, and this would just be an extra query on every page load
  // for a feature that can never actually be enabled there anyway (see
  // app/settings/page.tsx's own AppLockSection gate).
  // Per-user as of v2.0 (app-lock moved from the settings singleton to the
  // User row). getViewer() resolves to the instance owner in mono mode, so
  // this behaves exactly as before when AUTH_ENABLED is off.
  //
  // The viewer id is also what namespaces the service worker's runtime cache
  // and the app-lock's own sessionStorage key - both are per-browser stores
  // that would otherwise be shared between two accounts using the same
  // browser. See ServiceWorkerRegistration and AppLockGate.
  //
  // A deleted account is the one thing this cannot resolve: the session cookie
  // stays valid for its full 30 days, so the browser keeps sending it. The
  // page is replaced by SessionEnded, which signs the browser out - rendering
  // children here would run a page for an account that no longer exists.
  let viewer: Awaited<ReturnType<typeof getViewer>> | null = null;
  try {
    viewer = await getViewer();
  } catch (e) {
    if (!isDeletedSessionUser(e)) throw e;
  }

  const appLockEnabled =
    process.env.DEMO_MODE === "true" || !viewer
      ? false
      : await prisma.user
          .findUnique({ where: { id: viewer.id }, select: { appLockEnabled: true } })
          .then((user) => user?.appLockEnabled ?? false);

  return (
    <html
      lang={locale}
      // "auto" renders no attribute at all, letting globals.css's
      // @media(prefers-color-scheme) block decide live - "dark" renders an
      // explicit attribute too, even though it duplicates the bare :root
      // default's own values, specifically so that block's
      // :not([data-theme]) condition excludes it (an explicit "Sombre"
      // choice must never get silently overridden by a light-preferring
      // OS). See globals.css's "Light theme"/"Auto theme" comments for the
      // full reasoning.
      {...(theme === "auto" ? {} : { "data-theme": theme })}
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} antialiased h-full`}
    >
      <head>
        {/* crossOrigin is the whole point of hand-rolling this tag: a manifest
            is fetched WITHOUT credentials by default, so behind an
            authenticating reverse proxy (Cloudflare Access, Authelia,
            oauth2-proxy - all of which this project's README recommends) the
            request arrives with no session cookie and gets redirected to the
            proxy's own login host. The browser then refuses that cross-origin
            manifest under `default-src 'self'`, which is what a user saw:
            "Loading a manifest from ... violates the following Content
            Security Policy directive". "use-credentials" sends the cookie, the
            proxy lets it through, and it stays same-origin.

            Next's metadata.manifest only takes a URL and its file convention
            auto-links a tag we cannot influence, which is why the manifest is
            a plain Route Handler now - see that file. */}
        <link rel="manifest" href="/site.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className="flex min-h-full bg-[var(--background)]">
        <NextIntlClientProvider messages={messages}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-[100] px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium"
          >
            Skip to content
          </a>
          {viewer ? (
            <>
              <AppLockGate enabled={appLockEnabled} userId={viewer.id}>
                <SidebarWrapper />
                <MainContent>{children}</MainContent>
              </AppLockGate>
              {process.env.DEMO_MODE !== "true" && <AutoSync />}
              <ServiceWorkerRegistration offlinePages={process.env.AUTH_ENABLED !== "true"} userId={viewer.id} />
              <RealtimeRefresh />
            </>
          ) : (
            <SessionEnded />
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
