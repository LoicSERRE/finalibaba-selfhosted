import { describe, expect, it } from "vitest";
import {
  resolveSettingsTab,
  settingsTabHref,
  settingsVisibility,
  visibleSettingsTabs,
  SETTINGS_TABS,
} from "@/lib/domain/settings-tabs";

const mono = settingsVisibility({ isDemo: false, isMulti: false, isAdmin: true });
const member = settingsVisibility({ isDemo: false, isMulti: true, isAdmin: false });
const admin = settingsVisibility({ isDemo: false, isMulti: true, isAdmin: true });
const demo = settingsVisibility({ isDemo: true, isMulti: false, isAdmin: true });

describe("settingsVisibility", () => {
  it("mono mode: sensitive and admin, but nothing that needs a login", () => {
    expect(mono).toEqual({ sensitive: true, adminOnly: true, withAuth: false, userManagement: false });
  });

  it("a member: everything except the admin-only surfaces", () => {
    expect(member).toEqual({ sensitive: true, adminOnly: false, withAuth: true, userManagement: false });
  });

  it("an admin with auth on: everything", () => {
    expect(admin).toEqual({ sensitive: true, adminOnly: true, withAuth: true, userManagement: true });
  });

  it("demo mode turns off every sensitive surface, admin or not", () => {
    expect(demo).toEqual({ sensitive: false, adminOnly: false, withAuth: false, userManagement: false });
  });
});

describe("visibleSettingsTabs", () => {
  it("shows all six tabs whenever sensitive surfaces exist, in the fixed order", () => {
    for (const show of [mono, member, admin]) {
      expect(visibleSettingsTabs(show)).toEqual([...SETTINGS_TABS]);
    }
  });

  it("drops the tabs that would be empty in demo mode, rather than rendering them blank", () => {
    expect(visibleSettingsTabs(demo)).toEqual(["accounts", "profile", "display"]);
  });
});

describe("resolveSettingsTab", () => {
  const all = visibleSettingsTabs(admin);

  it("honours a tab that exists", () => {
    expect(resolveSettingsTab("security", all)).toBe("security");
  });

  it("falls back to the first tab when none is asked for", () => {
    expect(resolveSettingsTab(undefined, all)).toBe("accounts");
  });

  it("falls back on an unknown value instead of rendering nothing", () => {
    expect(resolveSettingsTab("nope", all)).toBe("accounts");
    expect(resolveSettingsTab("", all)).toBe("accounts");
  });

  it("never opens a tab hidden in this mode, even when asked by URL", () => {
    expect(resolveSettingsTab("security", visibleSettingsTabs(demo))).toBe("accounts");
  });

  it("takes the first value of a repeated parameter", () => {
    expect(resolveSettingsTab(["sharing", "security"], all)).toBe("sharing");
  });
});

describe("settingsTabHref", () => {
  it("builds the tab URL", () => {
    expect(settingsTabHref("profile")).toBe("/settings?tab=profile");
  });

  it("carries extra parameters, encoded - the GoCardless callback's ?gc= status", () => {
    expect(settingsTabHref("accounts", { gc: "already-connected" })).toBe("/settings?tab=accounts&gc=already-connected");
  });
});
