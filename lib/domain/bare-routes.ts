/**
 * Routes that render without the app shell.
 *
 * Three pages are reached by someone who is not (yet) inside the app: the
 * login screen, an invitation being redeemed, and a read-only share link.
 * None of them should show navigation - a login screen sitting next to a full
 * sidebar of links the visitor cannot follow reads as a broken page, and for
 * the share link it is a real isolation requirement rather than a cosmetic
 * one (see CLAUDE.md's "Read-only share links").
 *
 * The check lives here, in one pure function, because two separate client
 * components consume it - the sidebar itself, and the main element whose
 * bottom padding only exists to clear the mobile nav that is not rendered.
 * They were previously free to disagree.
 *
 * Why a pathname check rather than a route group with its own layout: the
 * shell is mounted by the root layout, so a nested layout cannot remove it,
 * and moving every other route under an (app) group to make that possible is
 * a far larger change than the problem warrants. This mirrors the mechanism
 * app/shared/[token] has always used.
 */
export function isBareRoute(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/invite" ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/shared/")
  );
}
