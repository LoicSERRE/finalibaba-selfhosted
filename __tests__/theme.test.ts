import { describe, expect, it } from "vitest";
import { resolveThemePreference } from "@/lib/domain/theme";

describe("resolveThemePreference", () => {
  it("returns 'light' for a 'light' cookie value", () => {
    expect(resolveThemePreference("light")).toBe("light");
  });

  it("returns 'auto' for an 'auto' cookie value", () => {
    expect(resolveThemePreference("auto")).toBe("auto");
  });

  it("returns 'dark' for an explicit 'dark' cookie value", () => {
    expect(resolveThemePreference("dark")).toBe("dark");
  });

  it("returns 'dark' (not 'auto') for an unset cookie - never silently auto-detects for a fresh visitor", () => {
    expect(resolveThemePreference(undefined)).toBe("dark");
  });

  it("returns 'dark' for an invalid/unrecognized cookie value", () => {
    expect(resolveThemePreference("purple")).toBe("dark");
  });
});
