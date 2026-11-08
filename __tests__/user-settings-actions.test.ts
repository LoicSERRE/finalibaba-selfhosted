import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Light coverage only, per this project's stated lib/actions/* boundary (see
// sonar-project.properties' sonar.coverage.exclusions), same mocked-Prisma
// shape as __tests__/transaction-splits-actions.test.ts.
//
// What these pin is one specific defect, found against a real production
// database: /settings renders two separate forms, and while they shared a
// single action, whichever one you submitted wrote ALL six columns - so the
// financial-profile card silently erased the country and reset the tax rates,
// and the tax card silently zeroed salary/expenses/savings. A field missing
// from the submitted form does not arrive as "leave unchanged", it arrives as
// null, and every parser here turns null into a real value.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { upsertMock } = vi.hoisted(() => ({ upsertMock: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { userSettings: { upsert: upsertMock } },
}));

vi.mock("@/lib/auth-context", () => ({
  getViewer: vi.fn(async () => ({ id: "user-owner", role: "ADMIN", isMonoMode: true })),
}));

import { updateFinancialProfile, updateTaxSettings } from "@/lib/actions/user-settings";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** The fields the upsert actually wrote, taken from its `update` payload. */
function writtenFields(): string[] {
  return Object.keys(upsertMock.mock.calls[0][0].update).sort();
}

beforeEach(() => {
  upsertMock.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateFinancialProfile", () => {
  it("writes only the profile fields, never the country or the tax rates", () => {
    return updateFinancialProfile(form({ salary: "1830", expenses: "900", saved: "400" })).then(() => {
      expect(writtenFields()).toEqual(["monthlyExpensesCents", "monthlySavedCents", "salaryNetCents"]);
      expect(upsertMock.mock.calls[0][0].update).toMatchObject({
        salaryNetCents: BigInt(183000),
        monthlyExpensesCents: BigInt(90000),
        monthlySavedCents: BigInt(40000),
      });
    });
  });
});

describe("updateTaxSettings", () => {
  it("writes only the tax fields, never salary/expenses/savings", async () => {
    await updateTaxSettings(form({ country: "FR", taxRatePea: "18.6", taxRateCto: "31.4", taxRateCrypto: "31.4" }));

    expect(writtenFields()).toEqual(["country", "taxRateCrypto", "taxRateCto", "taxRatePea"]);
    expect(upsertMock.mock.calls[0][0].update.country).toBe("FR");
  });

  it("keeps the default for an unreadable rate instead of storing NaN", async () => {
    await updateTaxSettings(form({ country: "FR", taxRatePea: "abc", taxRateCto: "250", taxRateCrypto: "-5" }));
    const written = upsertMock.mock.calls[0][0].update;
    expect(Number.isFinite(written.taxRatePea)).toBe(true);
    expect(written.taxRatePea).toBeGreaterThan(0);
    expect(written.taxRateCto).toBe(1); // clamped, as before
    expect(written.taxRateCrypto).toBe(0);
  });

  it("stores a real country code, and null for an unrecognised or blank one", async () => {
    await updateTaxSettings(form({ country: "GB" }));
    expect(upsertMock.mock.calls[0][0].update.country).toBe("GB");

    upsertMock.mockClear();
    await updateTaxSettings(form({ country: "" }));
    expect(upsertMock.mock.calls[0][0].update.country).toBeNull();

    upsertMock.mockClear();
    await updateTaxSettings(form({ country: "NOT_A_COUNTRY" }));
    expect(upsertMock.mock.calls[0][0].update.country).toBeNull();
  });

  it("clamps a rate into 0-1 rather than storing a nonsense percentage", async () => {
    await updateTaxSettings(form({ country: "FR", taxRatePea: "150", taxRateCto: "-20", taxRateCrypto: "31.4" }));

    const written = upsertMock.mock.calls[0][0].update;
    expect(written.taxRatePea).toBe(1);
    expect(written.taxRateCto).toBe(0);
    expect(written.taxRateCrypto).toBeCloseTo(0.314, 6);
  });
});

// A Server Action's return is serialised to the browser, so getUserSettings
// must never carry a secret column - audited: it returned the whole row,
// putting the smtpPassword/ntfyAuthToken ciphertexts in the client payload.
describe("getUserSettings", () => {
  it("strips every secret column and exposes only has* booleans", async () => {
    const { getUserSettings } = await import("@/lib/actions/user-settings");
    upsertMock.mockResolvedValue({
      userId: "user-owner",
      salaryNetCents: BigInt(100),
      smtpPassword: "enc:v1:SMTP",
      ntfyAuthToken: "enc:v1:NTFY",
      vapidPrivateKey: "enc:v1:VAPIDPRIV",
      vapidPublicKey: "VAPIDPUB",
    });

    const result = await getUserSettings();

    expect(result).not.toHaveProperty("smtpPassword");
    expect(result).not.toHaveProperty("ntfyAuthToken");
    expect(result).not.toHaveProperty("vapidPrivateKey");
    expect(result).not.toHaveProperty("vapidPublicKey");
    const serialised = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(serialised).not.toContain("enc:v1:");
    expect(result.hasSmtpPassword).toBe(true);
    expect(result.hasNtfyAuthToken).toBe(true);
    // Non-secret fields still come through for the UI.
    expect(result.salaryNetCents).toBe(BigInt(100));
  });

  it("reports has* false when no secret is stored", async () => {
    const { getUserSettings } = await import("@/lib/actions/user-settings");
    upsertMock.mockResolvedValue({ userId: "user-owner", smtpPassword: null, ntfyAuthToken: null });
    const result = await getUserSettings();
    expect(result.hasSmtpPassword).toBe(false);
    expect(result.hasNtfyAuthToken).toBe(false);
  });
});
