// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * Reported from a real instance, v2.10.6: "I create a test user, open a private
 * window, and after signing in it asks me for the app lock - which should not
 * happen. Refreshing clears it."
 *
 * The cause is that this component lives in the ROOT LAYOUT, so it stays
 * mounted across the client-side navigation a login performs. Its `unlocked`
 * state was seeded by `useState(!enabled)`, which runs once at mount - and at
 * mount the browser sat on /login, where there is no session, so getViewer()
 * falls back to the instance owner and `enabled` carried the OWNER's setting.
 * Signing in as somebody with no app-lock re-rendered with enabled=false while
 * the latched state stayed locked, and the unlock effect returns early for
 * exactly that case, so nothing ever cleared it. A reload remounts, which is
 * why refreshing looked like a fix.
 *
 * The test therefore drives the transition rather than a single render: a
 * component that only ever gets one set of props cannot see this bug.
 */

const translate = (key: string) => key;
vi.mock("next-intl", () => ({ useTranslations: () => translate }));

const pathname = { current: "/login" };
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: vi.fn(async () => ({})),
  startRegistration: vi.fn(async () => ({})),
}));
vi.mock("@/lib/actions/app-lock", () => ({
  startAppLockAuthentication: vi.fn(async () => ({})),
  verifyAppLockAuthentication: vi.fn(async () => ({ ok: true })),
  startAppLockRegistration: vi.fn(async () => ({})),
  verifyAppLockRegistration: vi.fn(async () => ({ ok: true })),
}));

import { AppLockGate } from "@/components/layout/app-lock-gate";
import { appLockDeviceKey } from "@/lib/domain/app-lock-device";

const OWNER = "user-owner";
const MEMBER = "user-member";
const CONTENT = "le-contenu-de-l-app";

function gate(enabled: boolean, userId: string) {
  return (
    <AppLockGate enabled={enabled} userId={userId}>
      <div>{CONTENT}</div>
    </AppLockGate>
  );
}

beforeEach(() => {
  pathname.current = "/login";
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("the reported sequence: sign in as somebody without app-lock", () => {
  it("shows the app, not a lock screen inherited from the owner", () => {
    // Mounts on /login, where the owner's flag is what the layout had to hand.
    const view = render(gate(true, OWNER));
    // Then the login lands: same mounted component, real user, no app-lock.
    pathname.current = "/";
    view.rerender(gate(false, MEMBER));

    expect(screen.getByText(CONTENT)).toBeTruthy();
    expect(screen.queryByText("lockTitle")).toBeNull();
  });

  it("stays unlocked when the account simply has no app-lock", () => {
    pathname.current = "/";
    render(gate(false, MEMBER));
    expect(screen.getByText(CONTENT)).toBeTruthy();
  });
});

describe("what must keep working, so the fix is not just 'never lock'", () => {
  it("locks a device that actually registered an authenticator", () => {
    localStorage.setItem(appLockDeviceKey(OWNER), "1");
    pathname.current = "/";
    render(gate(true, OWNER));
    expect(screen.getByText("lockTitle")).toBeTruthy();
    expect(screen.queryByText(CONTENT)).toBeNull();
  });

  it("does not lock a device that never registered one", () => {
    // A private window, a second phone: nothing to unlock with, and Settings
    // - where it would register - sits behind this very screen.
    pathname.current = "/";
    render(gate(true, OWNER));
    expect(screen.getByText(CONTENT)).toBeTruthy();
  });

  it("honours an unlock already granted this session", () => {
    localStorage.setItem(appLockDeviceKey(OWNER), "1");
    sessionStorage.setItem(`finalibaba-applock-unlocked:${OWNER}`, "1");
    pathname.current = "/";
    render(gate(true, OWNER));
    expect(screen.getByText(CONTENT)).toBeTruthy();
  });

  it("never locks a bare route, whatever the owner's setting says", () => {
    // /shared is handed to an advisor with no account and no device; the
    // anonymous request resolves to the owner, whose lock must not gate a
    // link they deliberately published.
    localStorage.setItem(appLockDeviceKey(OWNER), "1");
    pathname.current = "/shared/some-token";
    render(gate(true, OWNER));
    expect(screen.getByText(CONTENT)).toBeTruthy();
  });

  it("one account's registration does not lock another's session", () => {
    localStorage.setItem(appLockDeviceKey(OWNER), "1");
    pathname.current = "/";
    render(gate(true, MEMBER));
    expect(screen.getByText(CONTENT)).toBeTruthy();
  });
});
