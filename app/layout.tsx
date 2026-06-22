import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { SidebarWrapper } from "@/components/sidebar-wrapper";
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
  description: "Votre patrimoine, en un coup d'œil",
  manifest: "/manifest.json",
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} antialiased h-full`}>
      <body className="flex min-h-full bg-[var(--background)]">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-[100] px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium"
          >
            Aller au contenu
          </a>
          <SidebarWrapper />
          <main id="main-content" className="flex-1 overflow-y-auto p-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:p-8 md:pb-8">{children}</main>
      </body>
    </html>
  );
}
