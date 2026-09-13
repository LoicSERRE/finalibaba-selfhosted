import { describe, expect, it } from "vitest";
import { config, isAuthGated } from "@/proxy";

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

// The exemption list moved out of `config.matcher` and into `isAuthGated` in
// v2.10.6: the matcher now runs on MORE paths than the gate does, because
// every HTML response needs a per-request CSP nonce and /shared and /invite
// are real pages. The assertions below are unchanged - they were always about
// which paths are exempt, and that is exactly what the function answers.
const isGated = isAuthGated;

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

describe("the matcher is wider than the gate, on purpose", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each([
    ["/shared/sometoken", "an anonymous visitor renders a real page here"],
    ["/invite/sometoken", "so does an invitee"],
    ["/login", "and anyone at all"],
    ["/", "and every authenticated page"],
  ])("%s still runs the middleware, so it gets a CSP nonce (%s)", (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  it("/shared and /invite reach the middleware WITHOUT being auth-gated", () => {
    // The whole point of splitting the two: before v2.10.6 these skipped the
    // middleware entirely to skip the gate, and skipped the security headers
    // with it. Both properties have to hold at once now.
    for (const path of ["/shared/tok", "/invite/tok"]) {
      expect(matcher.test(path)).toBe(true);
      expect(isAuthGated(path)).toBe(false);
    }
  });

  it.each([
    ["/_next/static/chunk.js", "build assets execute no inline script"],
    ["/icon.svg", "nor does an image"],
  ])("%s is skipped entirely (%s)", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});
