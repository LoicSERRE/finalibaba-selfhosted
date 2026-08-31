import { describe, expect, it } from "vitest";
import { isBareRoute } from "@/lib/domain/bare-routes";

// Two client components read this - the sidebar's null return and the main
// element's padding - and a page that hides one but not the other looks worse
// than doing neither. Pinned here so they cannot drift apart again.

describe("isBareRoute", () => {
  it.each([
    ["/login", "the login screen"],
    ["/invite", "the invitation route with no token"],
    ["/invite/abc123", "an invitation being redeemed"],
    ["/shared/tok3n", "a read-only share link"],
    ["/shared/tok3n/anything", "a subpath under a share link"],
  ])("%s renders bare (%s)", (path, why) => {
    expect(isBareRoute(path), why).toBe(true);
  });

  it.each([
    ["/", "the dashboard"],
    ["/accounts", "a real page"],
    ["/accounts/abc", "a real subpage"],
    ["/settings", "settings"],
    ["/transactions", "the ledger"],
  ])("%s keeps the app shell (%s)", (path, why) => {
    expect(isBareRoute(path), why).toBe(false);
  });

  it.each([
    ["/logins", "a path that merely starts with login"],
    ["/invited", "a path that merely starts with invite"],
    ["/shared", "the bare word with no token - not a real share link"],
    ["/accounts/login", "login as a segment deeper in the tree"],
  ])("%s is not bare (%s)", (path, why) => {
    // Prefix matching is the exact mistake proxy.ts's own matcher already made
    // once, where an unanchored alternative let /icon-512999 through.
    expect(isBareRoute(path), why).toBe(false);
  });
});
