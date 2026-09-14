import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCOUNT_NOT_EXPORTED,
  SETTINGS_NOT_EXPORTED,
  USER_EXPORT_FORMAT,
  buildUserExport,
  parseUserExport,
  summariseImport,
  type UserExportInput,
} from "@/lib/domain/user-export";

/**
 * A backup that silently drops a column is worse than no backup: you find out
 * on the day you restore, which is the day you have nothing else. So the first
 * block here is a completeness check against `schema.prisma` itself rather
 * than against a fixture - adding a field to Account and forgetting to export
 * it must fail a test, not wait for a disaster.
 *
 * Same shape as __tests__/export-completeness.test.ts, which exists because
 * five whole analytics sections were on screen and in no export at all.
 */

const SCHEMA = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

/** Scalar columns of a model: a field whose type is not another model. */
function scalarFields(model: string): string[] {
  const models = new Set([...SCHEMA.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
  const block = SCHEMA.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!block) throw new Error(`model ${model} not found in schema.prisma`);
  return block[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@") && !l.startsWith("///"))
    .map((l) => l.split(/\s+/))
    .filter(([, type]) => type && !models.has(type.replace(/[?[\]]/g, "")))
    .map(([name]) => name);
}

describe("every column is either exported or explicitly not", () => {
  it("covers Account", () => {
    const exported = new Set([
      "name",
      "type",
      "manualValueCents",
      "liabilityCents",
      "purchasePriceCents",
      "insuranceMonthlyCents",
      "investmentSubtype",
      "investmentStartDate",
      "taxTreatment",
      "taxRatePct",
      "dividendsAlreadyNet",
      "interestRatePct",
      "loanAmountCents",
      "loanTaeg",
      "loanDurationMonths",
      "loanDeferralMonths",
      "loanStartDate",
    ]);
    const excluded = new Set<string>(ACCOUNT_NOT_EXPORTED);
    const unaccounted = scalarFields("Account").filter((f) => !exported.has(f) && !excluded.has(f));
    expect(unaccounted).toEqual([]);
  });

  it("covers UserSettings, where the exclusions are the credentials", () => {
    // Nothing to enumerate positively here: the builder copies whatever is not
    // on the exclusion list, so the test that matters is the reverse one below
    // (no credential ever reaches the file). This asserts the list still names
    // real columns, so a renamed column cannot leave a credential un-excluded.
    const columns = new Set(scalarFields("UserSettings"));
    const stale = SETTINGS_NOT_EXPORTED.filter(
      (f) => !columns.has(f) && !["id", "userId", "createdAt", "updatedAt"].includes(f)
    );
    expect(stale).toEqual([]);
  });
});

const INPUT: UserExportInput = {
  user: { username: "lepote", displayName: "Le Pote" },
  settings: {
    id: "s1",
    userId: "u1",
    salaryNetCents: BigInt(250000),
    smtpPassword: "hunter2",
    ntfyAuthToken: "tk_secret",
    vapidPrivateKey: "vapid-private",
    totpSecret: "JBSWY3DPEHPK3PXP",
    alertEmailTo: "moi@example.com",
  },
  institutions: [
    { id: "inst1", name: "Ma Banque", woobModule: "lcl", woobLogin: "login123", woobPassword: "pw456", trPin: "pin-8371" },
  ],
  categories: [
    {
      id: "cat1",
      name: "Courses",
      color: "#ff0000",
      kind: "EXPENSE",
      budgetCents: BigInt(40000),
      budgetRolloverEnabled: true,
      budgetRolloverEnabledAt: new Date("2026-01-01"),
    },
  ],
  accounts: [
    {
      id: "acc1",
      name: "Courant",
      type: "CHECKING",
      institutionId: "inst1",
      taxTreatment: "TAXABLE",
      taxRatePct: 0.3,
      dividendsAlreadyNet: false,
      syncId: "woob:inst1:42",
      gocardlessAccountId: "gc-99",
      history: [{ recordedAt: new Date("2026-02-01"), balanceCents: BigInt(123456) }],
      transactions: [
        {
          id: "tx1",
          date: new Date("2026-02-02"),
          label: "CARREFOUR",
          amountCents: BigInt(-4250),
          categoryId: "cat1",
          isInternalTransfer: false,
          isSecuritiesMovement: false,
          splits: [{ amountCents: BigInt(-4250), categoryId: "cat1" }],
        },
      ],
      holdings: [{ id: "h1", ticker: "IWDA", quantity: "3.5", lastPriceCents: BigInt(10000), currency: "EUR" }],
      sales: [],
      interestRateHistory: [{ ratePct: 0.017, until: new Date("2026-07-31") }],
      incomeEvents: [
        { type: "INTEREST", amountCents: BigInt(4600), date: new Date("2026-12-31"), transactionId: "tx1" },
      ],
    },
  ],
  recurringTransactions: [
    {
      accountId: "acc1",
      categoryId: "cat1",
      label: "Netflix",
      amountCents: BigInt(-1399),
      frequency: "MONTHLY",
      intervalCount: 1,
      anchorDate: new Date("2026-01-05"),
      active: true,
      autoDetected: true,
      amountVaries: false,
    },
  ],
  goals: [{ name: "Apport", targetCents: BigInt(8000000), accountRef: null, accountId: null }],
  alertRules: [{ kind: "ACCOUNT_BALANCE", active: true, accountId: "acc1", balanceThresholdCents: BigInt(100000) }],
};

describe("what a stolen export file yields", () => {
  const json = JSON.stringify(buildUserExport(INPUT));

  it("not one credential, whatever the row held", () => {
    // The whole point of v2.10.6 was that these stop being readable. An export
    // that writes them back out in clear, into a file destined for a Downloads
    // folder, would undo it in one feature.
    for (const secret of ["hunter2", "tk_secret", "vapid-private", "JBSWY3DPEHPK3PXP", "login123", "pw456", "pin-8371"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("keeps the institution's name and module, which are not secrets", () => {
    expect(json).toContain("Ma Banque");
    expect(json).toContain("lcl");
  });

  it("carries no instance-local sync plumbing", () => {
    // A globally-unique syncId in a portable file either collides on import or
    // silently re-points somebody else's bank connection.
    expect(json).not.toContain("woob:inst1:42");
    expect(json).not.toContain("gc-99");
  });
});

describe("what the person who made it gets back", () => {
  const data = buildUserExport(INPUT);

  it("the money, to the cent, as strings rather than lossy numbers", () => {
    expect(data.accounts[0].balances[0].balanceCents).toBe("123456");
    expect(data.accounts[0].transactions[0].amountCents).toBe("-4250");
    expect(data.goals[0].targetCents).toBe("8000000");
  });

  it("the links between rows, by the ids they had", () => {
    expect(data.accounts[0].institutionRef).toBe("inst1");
    expect(data.accounts[0].transactions[0].categoryRef).toBe("cat1");
    expect(data.accounts[0].transactions[0].splits[0].categoryRef).toBe("cat1");
    expect(data.accounts[0].incomeEvents[0].transactionRef).toBe("tx1");
    expect(data.recurringTransactions[0].accountRef).toBe("acc1");
    expect(data.alertRules[0].accountRef).toBe("acc1");
  });

  it("the settings that are settings, minus the ones that are secrets", () => {
    expect(data.settings?.salaryNetCents).toBe("250000");
    expect(data.settings?.alertEmailTo).toBe("moi@example.com");
    expect(data.settings).not.toHaveProperty("smtpPassword");
    expect(data.settings).not.toHaveProperty("totpSecret");
  });

  it("survives a round trip through JSON unchanged", () => {
    const back = parseUserExport(JSON.stringify(data));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.data).toEqual(data);
  });
});

describe("reading a file back", () => {
  it("refuses anything that is not one of ours", () => {
    expect(parseUserExport("not json at all")).toEqual({ ok: false, error: "not_json" });
    expect(parseUserExport('{"format":"something-else"}')).toEqual({ ok: false, error: "wrong_format" });
    expect(parseUserExport("[]")).toEqual({ ok: false, error: "wrong_format" });
  });

  it("refuses a file from a NEWER version rather than half-reading it", () => {
    // An older app quietly dropping fields it does not understand is how a
    // restore loses data without anybody noticing.
    const future = JSON.stringify({ format: USER_EXPORT_FORMAT, version: 99, accounts: [] });
    expect(parseUserExport(future)).toEqual({ ok: false, error: "unsupported_version" });
  });

  it("refuses one that is missing a whole section", () => {
    const truncated = JSON.stringify({ format: USER_EXPORT_FORMAT, version: 1, accounts: [] });
    expect(parseUserExport(truncated)).toEqual({ ok: false, error: "missing_sections" });
  });
});

describe("telling the user what an import is about to do", () => {
  it("counts what the file holds, so the confirmation is not a guess", () => {
    expect(summariseImport(buildUserExport(INPUT))).toEqual({
      institutions: 1,
      accounts: 1,
      transactions: 1,
      holdings: 1,
      categories: 1,
    });
  });
});
