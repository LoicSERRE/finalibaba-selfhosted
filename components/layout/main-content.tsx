"use client";

import { usePathname } from "next/navigation";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { isBareRoute } from "@/lib/domain/bare-routes";

/**
 * The app's main region, minus the chrome a pre-app screen should not carry.
 *
 * Both paddings here exist for the app shell specifically: the bottom one
 * clears the mobile nav, and the inner one is the page gutter every real page
 * wants. On a bare route (see lib/domain/bare-routes.ts) the nav is not
 * rendered at all, so reserving 6rem for it leaves dead space, and the gutter
 * fights a full-height centred layout - the login screen ended up scrollable
 * by exactly the padding, which is the kind of detail that reads as unfinished
 * even when nobody can name why.
 *
 * A client component because the pathname is what decides, and the root layout
 * is a server component that cannot read it. Same mechanism, and the same
 * shared predicate, as the sidebar's own null return.
 */
export function MainContent({ children }: Readonly<{ children: React.ReactNode }>) {
  const bare = isBareRoute(usePathname() ?? "/");

  return (
    // min-w-0, not overflow-y-auto: <main> never has a bounded height - the
    // window is what scrolls - so an overflow here scrolled nothing, but it
    // did make <main> the scroll container every `sticky` inside it is
    // measured against, and none of them ever stuck (the offline banner, the
    // Settings tab menu, the ledger's bulk toolbar; found in v2.14). The one
    // thing it really did - letting this flex child shrink below its content
    // width - is what min-w-0 says directly. Measured before and after on
    // every page at 1280/768/390px: no sideways overflow either way.
    <main
      id="main-content"
      className={
        bare
          ? "flex-1 min-w-0"
          : "flex-1 min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-8"
      }
    >
      {/* The offline banner stays on every route, bare ones included: a share
          link or a login attempt over a dropped connection is exactly when
          knowing you are offline matters. */}
      <div className="sticky top-0 z-10">
        <OfflineBanner />
      </div>
      <div className={bare ? "" : "p-4 md:p-8"}>{children}</div>
    </main>
  );
}
