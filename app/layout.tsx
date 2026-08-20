import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SidebarWrapper } from "@/components/layout/sidebar-wrapper";
import { AutoSync } from "@/components/layout/auto-sync";
import { ServiceWorkerRegistration } from "@/components/layout/service-worker-registration";
import { OfflineBanner } from "@/components/layout/offline-banner";
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
  const theme = (await cookies()).get("THEME")?.value;
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: "#6366f1",
    colorScheme: theme === "light" ? "light" : "dark",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = (await cookies()).get("THEME")?.value === "light" ? "light" : "dark";

  return (
    <html
      lang={locale}
      // No attribute at all for dark (the bare :root default in
      // globals.css) - only light is an explicit override, see that
      // file's own comment for why dark never auto-switches from
      // prefers-color-scheme.
      {...(theme === "light" ? { "data-theme": "light" } : {})}
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
          <SidebarWrapper />
          <main id="main-content" className="flex-1 overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-8">
            <div className="sticky top-0 z-10">
              <OfflineBanner />
            </div>
            <div className="p-4 md:p-8">{children}</div>
          </main>
          {process.env.DEMO_MODE !== "true" && <AutoSync />}
          <ServiceWorkerRegistration offlinePages={process.env.AUTH_ENABLED !== "true"} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
