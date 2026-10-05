// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The reference implementation of how a Settings form reports an outcome.
 * Both controls used to post straight to a Server Action with no feedback at
 * all: "sign out everywhere" threw into a form nobody read, so in production a
 * failure looked exactly like success - on the control someone reaches for
 * when a device has been stolen. These pin that every outcome is now visible.
 */

// Echoes the key, so an assertion names exactly which message rendered.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { revokeMock, policyMock } = vi.hoisted(() => ({ revokeMock: vi.fn(), policyMock: vi.fn() }));
vi.mock("@/lib/actions/users", () => ({ revokeOwnSessions: revokeMock }));
vi.mock("@/lib/actions/security", () => ({ setTwoFactorPolicy: policyMock }));

import { SessionControls } from "@/components/settings/session-controls";

beforeEach(() => {
  revokeMock.mockReset();
  policyMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function revokeButton() {
  return screen.getByRole("button", { name: /revokeAction/ });
}

describe("sign out everywhere", () => {
  it("shows the action's own error key, translated, when it reports one", async () => {
    revokeMock.mockResolvedValue({ ok: false, error: "revoke_failed" });
    render(<SessionControls isAdmin={false} requireTwoFactor={false} />);

    fireEvent.click(revokeButton());

    expect((await screen.findByRole("alert")).textContent).toContain("errors.revokeFailed");
  });

  it("shows a readable message when the action THROWS, never the raw error", async () => {
    revokeMock.mockRejectedValue(new Error("digest: 4815162342"));
    render(<SessionControls isAdmin={false} requireTwoFactor={false} />);

    fireEvent.click(revokeButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("errors.unexpected");
    expect(alert.textContent).not.toContain("4815162342");
  });

  it("explains rather than fails silently in mono mode", async () => {
    revokeMock.mockResolvedValue({ ok: false, error: "auth_disabled" });
    render(<SessionControls isAdmin={false} requireTwoFactor={false} />);

    fireEvent.click(revokeButton());

    expect((await screen.findByRole("alert")).textContent).toContain("errors.authDisabled");
  });

  it("shows nothing before anything was attempted", () => {
    render(<SessionControls isAdmin={false} requireTwoFactor={false} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the instance 2FA policy", () => {
  it("is offered to an admin only", () => {
    render(<SessionControls isAdmin={false} requireTwoFactor={false} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("confirms what was saved, politely, instead of giving no sign at all", async () => {
    policyMock.mockResolvedValue({ ok: true, data: { required: true } });
    render(<SessionControls isAdmin requireTwoFactor={false} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    expect((await screen.findByRole("status")).textContent).toContain("policySavedRequired");
    // The checkbox value actually reached the action.
    await waitFor(() => expect(policyMock).toHaveBeenCalled());
    const sent = policyMock.mock.calls[0][0] as FormData;
    expect(sent.get("requireTwoFactor")).toBe("on");
  });

  it("reports a failed save as an error", async () => {
    policyMock.mockResolvedValue({ ok: false, error: "save_failed" });
    render(<SessionControls isAdmin requireTwoFactor />);

    fireEvent.click(screen.getByRole("button", { name: /save/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("errors.policySaveFailed");
  });
});
