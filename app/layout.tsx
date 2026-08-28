import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SidebarWrapper } from "@/components/layout/sidebar-wrapper";
import { AutoSync } from "@/components/layout/auto-sync";
import { ServiceWorkerRegistration } from "@/components/layout/service-worker-registration";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { AppLockGate } from "@/components/layout/app-lock-gate";
import { RealtimeRefresh } from "@/components/layout/realtime-refresh";
import { prisma } from "@/lib/db/prisma";
import { resolveThemePreference } from "@/lib/domain/theme";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Finalibaba",
  description: "Your wealth, at a glance",
  // No explicit `manifest:` entry - app/manifest.ts is auto-detected and
  // linked by Next, same convention as app/icon.tsx/apple-icon.tsx below.
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
  const appLockEnabled =
    process.env.DEMO_MODE === "true"
      ? false
      : (await prisma.userSettings.findUnique({ where: { id: "singleton" }, select: { appLockEnabled: true } }))
          ?.appLockEnabled ?? false;

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
      <body className="flex min-h-full bg-[var(--background)]">
        <NextIntlClientProvider messages={messages}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-[100] px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium"
          >
            Skip to content
          </a>
          <AppLockGate enabled={appLockEnabled}>
            <SidebarWrapper />
            <main id="main-content" className="flex-1 overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-8">
              <div className="sticky top-0 z-10">
                <OfflineBanner />
              </div>
              <div className="p-4 md:p-8">{children}</div>
            </main>
          </AppLockGate>
          {process.env.DEMO_MODE !== "true" && <AutoSync />}
          <ServiceWorkerRegistration offlinePages={process.env.AUTH_ENABLED !== "true"} />
          <RealtimeRefresh />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
