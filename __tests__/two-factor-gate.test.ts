import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The layout half of the instance 2FA policy (getViewer is the other half,
// covered in auth-context.test.ts). Source-level, like main-content.test.ts:
// rendering the root layout needs a session, the DB and next-intl, and the
// property is one expression.

const layout = readFileSync("app/layout.tsx", "utf8");
const gate = readFileSync("components/auth/two-factor-required.tsx", "utf8");

describe("the 2FA gate in app/layout.tsx", () => {
  const expr = /const mustSetUpTotp =([\s\S]*?);/.exec(layout)?.[1] ?? "";

  it("finds the condition at all", () => {
    expect(expr).toContain("requiresTwoFactor()");
  });

  it("exempts no route", () => {
    // /settings used to be exempt, as the page the setup lived on - and it
    // lists the user's API keys and share links, so a password alone was
    // enough to copy one.
    expect(expr).not.toMatch(/pathname/);
  });

  it("carries the setup itself, since there is no page left to send the user to", () => {
    expect(gate).toMatch(/<TwoFactorSection totpEnabled=\{false\} \/>/);
    expect(gate).not.toMatch(/href=/);
  });
});
