import { describe, expect, it } from "vitest";
import {
  buildCompanyShare,
  netAssetValueCents,
  ageAt,
  usufructPct,
  weightedParts,
  stakeValueCents,
  stakeOfAssociate,
  fullStake,
  parseBirthDate,
  capTableDraft,
  withCompaniesGroup,
  partsPct,
  mergedKeys,
  shareCents,
  sharesOn,
  shareTotals,
  validateCapTable,
  type CompanyShare,
} from "@/lib/domain/company";
import { computeDashboard, type DashboardAccount, type DashboardInput } from "@/lib/domain/dashboard";

// The valuation module every net-worth consumer goes through for companies
// (dev-docs/companies.md, principle 4), to the cent, and the one thing it
// must never get wrong: a company counts once, at the share held.

const NOW = new Date("2026-07-28T12:00:00.000Z");

function share(overrides: Partial<CompanyShare> = {}): CompanyShare {
  return {
    companyId: "co-1",
    name: "SCI Les Tilleuls",
    parts: 600,
    totalParts: 1000,
    companyValueCents: BigInt(180_000_00),
    currentAccountCents: BigInt(0),
    valueCents: BigInt(108_000_00),
    history: [],
    ...overrides,
  };
}

function cash(id: string, balanceCents: number): DashboardAccount {
  return {
    id,
    name: id,
    type: "CHECKING",
    institutionId: null,
    institution: null,
    taxTreatment: "TAXABLE",
    taxRatePct: null,
    manualValueCents: null,
    liabilityCents: null,
    loanAmountCents: null,
    loanTaeg: null,
    loanDurationMonths: null,
    loanDeferralMonths: null,
    loanStartDate: null,
    holdings: [],
    history: [{ balanceCents: BigInt(balanceCents) }],
  };
}

function input(overrides: Partial<DashboardInput>): DashboardInput {
  return { accounts: [], allBalances: [], intlLocale: "fr-FR", now: NOW, ...overrides };
}

describe("validateCapTable", () => {
  it("accepts parts that add up to the total exactly", () => {
    expect(validateCapTable(1000, [{ name: "Camille", parts: 600 }, { name: "Marie", parts: 400 }])).toBeNull();
  });

  it.each([
    ["a total that is not a positive integer", 0, [{ name: "A", parts: 1 }], "total_parts_invalid"],
    ["a fractional total", 10.5, [{ name: "A", parts: 10.5 }], "total_parts_invalid"],
    ["a total sent as a string", "1000", [{ name: "A", parts: 1000 }], "total_parts_invalid"],
    ["no associates", 100, [], "no_associates"],
    ["associates that are not a list", 100, { name: "A", parts: 100 }, "no_associates"],
    ["a blank name", 100, [{ name: "  ", parts: 100 }], "name_required"],
    ["an associate who holds nothing at all", 100, [{ name: "A", parts: 0 }, { name: "B", parts: 100 }], "associate_without_parts"],
    ["negative parts", 100, [{ name: "A", parts: -50 }, { name: "B", parts: 150 }], "parts_invalid"],
    ["parts sent as a string", 100, [{ name: "A", parts: "100" }], "parts_invalid"],
    ["parts that fall short", 1000, [{ name: "A", parts: 600 }, { name: "B", parts: 399 }], "parts_sum_mismatch"],
    ["a negative current account", 100, [{ name: "A", parts: 100, currentAccountCents: -1 }], "current_account_invalid"],
    ["a fractional current account", 100, [{ name: "A", parts: 100, currentAccountCents: 10.5 }], "current_account_invalid"],
    ["a current account sent as a string", 100, [{ name: "A", parts: 100, currentAccountCents: "500" }], "current_account_invalid"],
    ["parts that overshoot", 1000, [{ name: "A", parts: 600 }, { name: "B", parts: 401 }], "parts_sum_mismatch"],
    [
      "one user linked twice",
      100,
      [{ name: "A", parts: 50, userId: "u1" }, { name: "B", parts: 50, userId: "u1" }],
      "duplicate_user",
    ],
  ])("rejects %s", (_label, total, rows, error) => {
    expect(validateCapTable(total, rows)).toBe(error);
  });
});

describe("shareCents", () => {
  it("is the value times parts over the total", () => {
    expect(shareCents(BigInt(180_000_00), 600, 1000)).toBe(BigInt(108_000_00));
  });

  it("rounds half-up once, at the end", () => {
    // 100.00 € over 3 parts: 33.333… → 33.33 € for one part.
    expect(shareCents(BigInt(100_00), 1, 3)).toBe(BigInt(33_33));
    expect(shareCents(BigInt(1), 1, 2)).toBe(BigInt(1)); // 0.5 cent rounds up
  });

  it("stays negative for a company that owes more than it holds", () => {
    expect(shareCents(BigInt(-50_000_00), 500, 1000)).toBe(BigInt(-25_000_00));
  });

  it("is 0 rather than dividing by zero", () => {
    expect(shareCents(BigInt(100_00), 1, 0)).toBe(BigInt(0));
  });
});

describe("buildCompanyShare", () => {
  it("scales every history point to the share, not just today's value", () => {
    const s = buildCompanyShare({ id: "co-1", name: "SCI", totalParts: 4 }, 1, BigInt(400_00), [
      { isoDate: "2026-01-01", netWorth: 200_00 },
      { isoDate: "2026-02-01", netWorth: 400_00 },
    ]);
    expect(s.valueCents).toBe(BigInt(100_00));
    expect(s.history).toEqual([
      { isoDate: "2026-01-01", valueCents: 50_00 },
      { isoDate: "2026-02-01", valueCents: 100_00 },
    ]);
  });
});

describe("sharesOn / mergedKeys", () => {
  const s = share({
    history: [
      { isoDate: "2026-01-10", valueCents: 100 },
      { isoDate: "2026-01-20", valueCents: 300 },
    ],
  });

  it("carries the last known value forward and is 0 before the first", () => {
    const keys = ["2026-01-01", "2026-01-10", "2026-01-15", "2026-01-25"];
    expect(sharesOn(keys, [s]).map((v) => v.net)).toEqual([0, 100, 100, 300]);
  });

  it("keeps negative values out of the positive (allocation) total", () => {
    const negative = share({ history: [{ isoDate: "2026-01-01", valueCents: -500 }] });
    expect(sharesOn(["2026-01-02"], [s, negative])).toEqual([{ net: -500, positive: 0 }]);
  });

  it("merges a person's days with the companies' days, sorted", () => {
    expect(mergedKeys(["2026-01-15", "2026-01-01"], [s])).toEqual(["2026-01-01", "2026-01-10", "2026-01-15", "2026-01-20"]);
  });

  it("can bucket by month, taking the month's last point", () => {
    const toMonth = (d: string) => d.slice(0, 7);
    expect(mergedKeys([], [s], toMonth)).toEqual(["2026-01"]);
    expect(sharesOn(["2026-01"], [s], toMonth)[0].net).toBe(300);
  });
});

describe("shareTotals", () => {
  it("puts a positive share in assets and a negative one in liabilities", () => {
    expect(shareTotals([share({ valueCents: BigInt(100) }), share({ valueCents: BigInt(-40) })])).toEqual({
      assetsCents: BigInt(100),
      liabilitiesCents: BigInt(40),
    });
  });
});

describe("computeDashboard with company shares", () => {
  const own = [cash("perso", 10_000_00)];
  const ownBalances = [{ accountId: "perso", recordedAt: new Date("2026-07-01T12:00:00Z"), balanceCents: BigInt(10_000_00) }];

  it("is unchanged without shares, the companies bucket at 0", () => {
    const r = computeDashboard(input({ accounts: own, allBalances: ownBalances }));
    expect(r.netWorth).toBe(BigInt(10_000_00));
    expect(r.allocationRaw.companies).toBe(0);
    expect(r.allocationHistory.every((p) => p.companies === 0)).toBe(true);
  });

  it("adds the share once, as its own bucket", () => {
    const r = computeDashboard(input({ accounts: own, allBalances: ownBalances, companyShares: [share()] }));
    expect(r.netWorth).toBe(BigInt(10_000_00 + 108_000_00));
    expect(r.grossAssets).toBe(BigInt(10_000_00 + 108_000_00));
    expect(r.allocationRaw.companies).toBe(108_000_00);
    expect(r.allocationRaw.cash).toBe(10_000_00);
  });

  it("counts a negative share as a liability, not as a negative asset", () => {
    const r = computeDashboard(input({ accounts: own, allBalances: ownBalances, companyShares: [share({ valueCents: BigInt(-2_000_00) })] }));
    expect(r.netWorth).toBe(BigInt(8_000_00));
    expect(r.grossAssets).toBe(BigInt(10_000_00));
    expect(r.totalLiabilities).toBe(BigInt(2_000_00));
    expect(r.allocationRaw.companies).toBe(0);
  });

  it("draws the share in the history, on the company's days too", () => {
    const companyShares = [
      share({
        history: [
          { isoDate: "2026-06-15", valueCents: 50_000_00 },
          { isoDate: "2026-07-10", valueCents: 60_000_00 },
        ],
      }),
    ];
    const r = computeDashboard(input({ accounts: own, allBalances: ownBalances, companyShares }));
    expect(r.history.map((p) => [p.isoDate, p.netWorth])).toEqual([
      ["2026-06-15", 50_000_00], // before the person's own first day: the share alone
      ["2026-07-01", 10_000_00 + 50_000_00],
      ["2026-07-10", 10_000_00 + 60_000_00],
    ]);
    expect(r.allocationHistory.at(-1)).toMatchObject({ cash: 10_000_00, companies: 60_000_00 });
  });

  it("counts a person with only a share as having data", () => {
    expect(computeDashboard(input({ companyShares: [share()] })).hasAccounts).toBe(true);
  });
});

describe("capTableDraft / partsPct (the forms)", () => {
  it("adds what is typed so far and says what is left", () => {
    expect(capTableDraft(1000, [600, 300])).toEqual({ allocated: 900, remaining: 100, complete: false });
    expect(capTableDraft(1000, [600, 400])).toEqual({ allocated: 1000, remaining: 0, complete: true });
  });

  it("counts a half-typed row as nothing, never as complete", () => {
    expect(capTableDraft(100, [Number.NaN, 100])).toMatchObject({ allocated: 100, complete: true });
    expect(capTableDraft(0, [])).toMatchObject({ complete: false });
    expect(capTableDraft(100, [150, -50])).toMatchObject({ allocated: 150, complete: false });
  });

  it("rounds a percentage to one decimal", () => {
    expect(partsPct(1, 3)).toBeCloseTo(33.3, 10);
    expect(partsPct(600, 1000)).toBeCloseTo(60, 10);
    expect(partsPct(5, 0)).toBe(0);
  });
});

describe("withCompaniesGroup", () => {
  const groups = [{ name: "Banque", logoUrl: null, total: BigInt(10_00), accounts: [{ id: "a", name: "Livret", value: BigInt(10_00), type: "SAVINGS" }] }];

  it("leaves the list alone without shares", () => {
    expect(withCompaniesGroup(groups, [], "Sociétés")).toBe(groups);
  });

  it("adds one group whose rows are the shares, so the list adds up to the net worth", () => {
    const out = withCompaniesGroup(groups, [share(), share({ companyId: "co-2", name: "Holding", valueCents: BigInt(-5_00) })], "Sociétés");
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ name: "Sociétés", total: BigInt(108_000_00 - 5_00) });
    expect(out[1].accounts.map((a) => [a.id, a.type])).toEqual([["co-1", "COMPANY"], ["co-2", "COMPANY"]]);
  });
});

describe("current accounts (comptes courants d'associés)", () => {
  // 180 000 on the company's bank account, 50 000 of it lent by associates:
  // the company owes that back, so its net asset value is 130 000.
  const company = { id: "co-1", name: "SCI", totalParts: 1000 };
  const accounts = { totalCents: BigInt(50_000_00), ownCents: BigInt(30_000_00) };

  it("come off the company's value before anyone's share", () => {
    expect(netAssetValueCents(BigInt(180_000_00), BigInt(50_000_00))).toBe(BigInt(130_000_00));
    expect(buildCompanyShare(company, 600, BigInt(180_000_00), [], accounts).companyValueCents).toBe(BigInt(130_000_00));
  });

  it("add the lender's own current account to their share, once", () => {
    // 60 % of 130 000 = 78 000, plus the 30 000 they lent.
    const s = buildCompanyShare(company, 600, BigInt(180_000_00), [], accounts);
    expect(s.valueCents).toBe(BigInt(78_000_00 + 30_000_00));
    expect(s.currentAccountCents).toBe(BigInt(30_000_00));
  });

  it("add up, across all associates, to exactly the company's accounts", () => {
    // Nothing is created or lost: the two associates' figures together are
    // the 180 000 sitting on the company's accounts.
    const a = buildCompanyShare(company, 600, BigInt(180_000_00), [], accounts);
    const b = buildCompanyShare(company, 400, BigInt(180_000_00), [], { totalCents: BigInt(50_000_00), ownCents: BigInt(20_000_00) });
    expect(a.valueCents + b.valueCents).toBe(BigInt(180_000_00));
  });

  it("apply to every day of the history, at today's amounts", () => {
    const s = buildCompanyShare(company, 600, BigInt(180_000_00), [{ isoDate: "2026-01-01", netWorth: 100_000_00 }], accounts);
    // 60 % of (100 000 - 50 000) + 30 000.
    expect(s.history).toEqual([{ isoDate: "2026-01-01", valueCents: 30_000_00 + 30_000_00 }]);
  });

  it("change nothing when there are none", () => {
    const s = buildCompanyShare(company, 600, BigInt(180_000_00), []);
    expect(s).toMatchObject({ companyValueCents: BigInt(180_000_00), currentAccountCents: BigInt(0), valueCents: BigInt(108_000_00) });
  });
});

describe("démembrement (step 3, art. 669 I CGI)", () => {
  const born = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it.each([
    [0, 0.9], [20, 0.9], [21, 0.8], [30, 0.8], [31, 0.7], [40, 0.7], [41, 0.6], [50, 0.6],
    [51, 0.5], [60, 0.5], [61, 0.4], [70, 0.4], [71, 0.3], [80, 0.3], [81, 0.2], [90, 0.2], [91, 0.1], [105, 0.1],
  ])("values an usufruct at %i years old at %f of full ownership", (age, pct) => {
    expect(usufructPct(age)).toBe(pct);
  });

  it("counts age in full years, birthday included", () => {
    expect(ageAt(born("1956-07-28"), new Date("2026-07-27T12:00:00Z"))).toBe(69);
    expect(ageAt(born("1956-07-28"), new Date("2026-07-28T12:00:00Z"))).toBe(70);
  });

  const parent = { id: "p", birth: born("1956-01-01") };
  const blocks = [{ parts: 1000, fullOwnerId: null, usufructuaryId: "p", bareOwnerId: "c" }];
  const births = new Map([["p", parent.birth], ["c", null]]);

  it("splits one block between usufruct and bare ownership, adding up to the whole", () => {
    const at = new Date("2026-07-28T12:00:00Z"); // parent is 70: 40 / 60
    const usufruct = weightedParts(stakeOfAssociate("p", blocks, births), at);
    const bare = weightedParts(stakeOfAssociate("c", blocks, births), at);
    expect(usufruct.toNumber()).toBe(400);
    expect(bare.toNumber()).toBe(600);
    expect(usufruct.plus(bare).toNumber()).toBe(1000);
  });

  it("moves value from usufruct to bare ownership as the usufructuary ages", () => {
    const before = stakeValueCents(BigInt(100_000_00), stakeOfAssociate("c", blocks, births), 1000, null, new Date("2026-12-31T12:00:00Z"));
    const after = stakeValueCents(BigInt(100_000_00), stakeOfAssociate("c", blocks, births), 1000, null, new Date("2027-01-01T12:00:00Z"));
    expect(before).toBe(BigInt(60_000_00)); // parent 70: bare ownership 60 %
    expect(after).toBe(BigInt(70_000_00)); // parent 71: bare ownership 70 %
  });

  it("uses each history day's age, not today's", () => {
    const s = buildCompanyShare(
      { id: "co", name: "SCI", totalParts: 1000 },
      stakeOfAssociate("c", blocks, births),
      BigInt(100_000_00),
      [{ isoDate: "2026-06-01", netWorth: 100_000_00 }, { isoDate: "2027-06-01", netWorth: 100_000_00 }],
      undefined,
      new Date("2027-06-01T12:00:00Z"),
    );
    expect(s.history.map((p) => p.valueCents)).toEqual([60_000_00, 70_000_00]);
  });

  it("refuses to value a démembrement without being told which day it is", () => {
    expect(() =>
      buildCompanyShare({ id: "co", name: "SCI", totalParts: 1000 }, stakeOfAssociate("c", blocks, births), BigInt(1), []),
    ).toThrow(/asOf/);
  });

  it("applies the discount to the parts only", () => {
    expect(stakeValueCents(BigInt(100_000_00), fullStake(1000), 1000, 0.15, new Date())).toBe(BigInt(85_000_00));
    const s = buildCompanyShare({ id: "co", name: "SCI", totalParts: 1000, discountPct: 0.15 }, 1000, BigInt(150_000_00), [], {
      totalCents: BigInt(50_000_00),
      ownCents: BigInt(50_000_00),
    });
    // ANR 100 000, less 15 % = 85 000, plus the 50 000 current account in full.
    expect(s.valueCents).toBe(BigInt(135_000_00));
  });

  describe("in the cap table", () => {
    const rows = [
      { name: "Parent", parts: 0, birthDate: "1956-01-01" },
      { name: "Enfant", parts: 0 },
    ];

    it("accepts parts held only through a démembrement block", () => {
      expect(validateCapTable(1000, rows, [{ parts: 1000, usufructuary: 0, bareOwner: 1 }])).toBeNull();
    });

    it("counts a block once in the total", () => {
      expect(validateCapTable(1000, rows, [{ parts: 999, usufructuary: 0, bareOwner: 1 }])).toBe("parts_sum_mismatch");
    });

    it.each([
      ["the same associate on both sides", [{ parts: 1000, usufructuary: 0, bareOwner: 0 }], "dismemberment_invalid"],
      ["an index out of the rows", [{ parts: 1000, usufructuary: 0, bareOwner: 2 }], "dismemberment_invalid"],
      ["an index sent as a string", [{ parts: 1000, usufructuary: "0", bareOwner: 1 }], "dismemberment_invalid"],
      ["zero parts", [{ parts: 0, usufructuary: 0, bareOwner: 1 }], "dismemberment_invalid"],
      ["blocks that are not a list", { parts: 1000 }, "dismemberment_invalid"],
    ])("refuses %s", (_label, dm, error) => {
      expect(validateCapTable(1000, rows, dm)).toBe(error);
    });

    it("requires the usufructuary's birth date, not the bare owner's", () => {
      expect(validateCapTable(1000, [{ name: "P", parts: 0 }, { name: "E", parts: 0, birthDate: "2000-01-01" }], [
        { parts: 1000, usufructuary: 0, bareOwner: 1 },
      ])).toBe("birth_date_required");
    });

    it.each(["1956-02-30", "56-01-01", "1850-01-01", "not a date"])("refuses the birth date %s", (birthDate) => {
      expect(validateCapTable(10, [{ name: "A", parts: 10, birthDate }])).toBe("birth_date_invalid");
    });

    it("parses a real day only", () => {
      expect(parseBirthDate("1956-01-01")?.toISOString()).toBe("1956-01-01T00:00:00.000Z");
      expect(parseBirthDate("1956-02-30")).toBeNull();
    });
  });
});
