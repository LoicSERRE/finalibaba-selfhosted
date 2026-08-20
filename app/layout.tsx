import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6366f1",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} antialiased h-full`}>
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
