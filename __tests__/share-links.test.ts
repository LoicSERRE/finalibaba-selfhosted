import { describe, expect, it } from "vitest";
import { generateShareToken, isShareLinkExpired } from "@/lib/domain/share-links";

describe("generateShareToken", () => {
  it("generates a long, URL-safe, unique token", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("isShareLinkExpired", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");

  it("is never expired when expiresAt is null (no expiry set)", () => {
    expect(isShareLinkExpired(null, now)).toBe(false);
  });

  it("is expired when expiresAt is in the past", () => {
    expect(isShareLinkExpired(new Date("2026-08-01T00:00:00.000Z"), now)).toBe(true);
  });

  it("is not expired when expiresAt is in the future", () => {
    expect(isShareLinkExpired(new Date("2026-09-01T00:00:00.000Z"), now)).toBe(false);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(isShareLinkExpired(now, now)).toBe(true);
  });
});
