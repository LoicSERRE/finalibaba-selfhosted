import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

// The middleware matcher is one long negative-lookahead regex listing every
// path that must NOT go through the NextAuth session gate. Getting it wrong is
// silent in both directions: too narrow and a legitimately public page becomes
// unreachable, too broad and a private one stops being gated.
//
// Written after the post-v2.0 security audit found /invite/[token] missing from
// it. On an AUTH_ENABLED=true instance that redirected every invitee to /login -
// a page they cannot get past, since not having an account is the whole premise -
// making the entire invitation flow unreachable. Nothing caught it because the
// multi-user tests created users directly in the database.
//
// These assertions are about the regex itself, so they hold without a server.

const MATCHER = config.matcher[0];
const re = new RegExp(`^${MATCHER}$`);

/** True when the middleware (and therefore the auth gate) runs for this path. */
const isGated = (path: string) => re.test(path);

describe("proxy matcher - paths that must stay public", () => {
  it.each([
    ["/invite/sometoken", "an invitee has no account yet, by definition"],
    ["/invite", "the bare route, for the same reason"],
    ["/shared/sometoken", "read-only share links are their own token gate"],
    ["/api/auth/session", "NextAuth's own endpoints"],
    ["/api/health", "the container healthcheck has no session"],
    ["/api/v1", "the public REST API authenticates with its own ApiKey"],
    ["/api/v1/net-worth", "same, on a real endpoint"],
    ["/api/alerts/check", "sync container calls it with a bearer token"],
    ["/api/transactions/auto-categorize", "same"],
    ["/api/investments/snapshot-balances", "same"],
    ["/api/realtime/notify", "same"],
    ["/sw.js", "a service worker fetch must not be redirected to /login"],
    ["/site.webmanifest", "nor a manifest fetch"],
    ["/icon-512", "nor a generated icon"],
    ["/_next/static/chunk.js", "build assets"],
  ])("%s is exempt (%s)", (path) => {
    expect(isGated(path)).toBe(false);
  });
});

describe("proxy matcher - paths that must stay gated", () => {
  it.each([
    ["/"],
    ["/accounts"],
    ["/accounts/some-id"],
    ["/settings"],
    ["/analytics"],
    ["/transactions"],
    ["/api/backup"],
    // Opened by the browser with a real session, unlike /api/realtime/notify.
    ["/api/realtime/stream"],
  ])("%s goes through the auth gate", (path) => {
    expect(isGated(path)).toBe(true);
  });
});

describe("proxy matcher - exemptions must not become prefix holes", () => {
  // The documented lesson from the icon-512 fix: an unanchored alternative
  // matches as a bare prefix, so a nonexistent sibling path silently inherits
  // the exemption. Every alternative added since is `$`-anchored or shaped as
  // "exact path or a real subpath"; these assert that shape holds.
  it.each([
    ["/invite999"],
    ["/api/v1999/net-worth"],
    ["/icon-512999"],
    ["/sw.js.map"],
  ])("%s is still gated", (path) => {
    expect(isGated(path)).toBe(true);
  });
});
