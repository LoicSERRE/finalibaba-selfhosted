import { describe, expect, it } from "vitest";
import { refusesPublicPageWrite } from "@/proxy";

// A Server Action is a POST to the page it is called at, and with auth off it
// runs as the owner: the public token pages must take none.
describe("refusesPublicPageWrite", () => {
  it.each([["POST"], ["PUT"], ["DELETE"], ["PATCH"]])("refuses %s on a share link, auth on or off", (method) => {
    for (const auth of [true, false]) {
      expect(refusesPublicPageWrite("/shared/abc", method, auth)).toBe(true);
      expect(refusesPublicPageWrite("/shared", method, auth)).toBe(true);
      expect(refusesPublicPageWrite("/shared/abc/deeper", method, auth)).toBe(true);
    }
  });

  it("lets a share link be read", () => {
    expect(refusesPublicPageWrite("/shared/abc", "GET", false)).toBe(false);
    expect(refusesPublicPageWrite("/shared/abc", "HEAD", false)).toBe(false);
  });

  it("lets an invitation be accepted with auth on, and nothing be posted there with it off", () => {
    expect(refusesPublicPageWrite("/invite/tok", "POST", true)).toBe(false);
    expect(refusesPublicPageWrite("/invite/tok", "POST", false)).toBe(true);
    expect(refusesPublicPageWrite("/invite/tok", "GET", false)).toBe(false);
  });

  it("leaves every other path to the session gate", () => {
    expect(refusesPublicPageWrite("/settings", "POST", false)).toBe(false);
    expect(refusesPublicPageWrite("/sharedX", "POST", false)).toBe(false);
    expect(refusesPublicPageWrite("/invitees", "POST", false)).toBe(false);
    expect(refusesPublicPageWrite("/api/v1/accounts", "POST", false)).toBe(false);
  });
});
