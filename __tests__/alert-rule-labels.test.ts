import { describe, expect, it } from "vitest";
import { ruleLabel, type AlertRuleRow } from "@/lib/domain/alert-rule-labels";

/**
 * The sentence each alert rule shows on screen - eight kinds, 23 cyclomatic
 * complexity, and until v2.10.5 untestable without rendering an 810-line
 * client component around it. Moving it here is what makes these plain unit
 * tests rather than a DOM.
 *
 * What they pin is what the function is actually for: putting the right NOUN
 * in the sentence. Each kind reads a different field - one an account, one a
 * holding, one a category - and a rule pointing at the wrong one looks
 * entirely normal on screen while describing something else. That is not
 * hypothetical: a deliberate swap of exactly that shape was what proved the
 * rendering harness worth having a few hours earlier.
 */

/** Echoes the key and its values, so an assertion sees both. */
function t(key: string, vars?: Record<string, string | number>): string {
  if (!vars) return key;
  const pairs = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",");
  return `${key}(${pairs})`;
}

const ACCOUNT = { id: "acc-1", name: "Courant" };
const HOLDING = { id: "h1", ticker: "IE00B4L5Y983", name: "MSCI World", account: { id: "acc-2", name: "PEA" } };
const CATEGORY = { id: "c1", name: "Alimentation", budgetCents: BigInt(40000) };

function rule(over: Partial<AlertRuleRow> = {}): AlertRuleRow {
  return {
    id: "r1",
    kind: "ACCOUNT_BALANCE",
    active: true,
    message: null,
    balanceThresholdCents: BigInt(50000),
    gainThresholdPct: null,
    gainUnit: null,
    transactionDirection: null,
    account: ACCOUNT,
    holding: null,
    category: null,
    ...over,
  } as AlertRuleRow;
}

describe("each kind names the thing it actually watches", () => {
  it("an account balance names the account and quotes the threshold", () => {
    const label = ruleLabel(rule(), t);
    expect(label).toContain("account=Courant");
    expect(label).toContain("threshold=");
  });

  it("an overdraft names the account and quotes no threshold", () => {
    // The threshold is fixed at 0 and never typed by anyone, so repeating it
    // back would be noise dressed as information.
    const label = ruleLabel(rule({ kind: "ACCOUNT_OVERDRAFT", balanceThresholdCents: BigInt(0) }), t);
    expect(label).toContain("account=Courant");
    expect(label).not.toContain("threshold=");
  });

  it("a holding price names the holding, not the account it sits in", () => {
    const label = ruleLabel(rule({ kind: "HOLDING_PRICE", account: null, holding: HOLDING }), t);
    expect(label).toContain("MSCI World");
    expect(label).not.toContain("Courant");
  });

  it("a budget overrun names the category, not an account", () => {
    const label = ruleLabel(rule({ kind: "BUDGET_OVERRUN", account: null, category: CATEGORY }), t);
    expect(label).toContain("category=Alimentation");
  });

  it("a rebalancing drift names the holding and its tolerance in points", () => {
    const label = ruleLabel(
      rule({ kind: "REBALANCING_DRIFT", account: null, holding: HOLDING, gainThresholdPct: 5 }),
      t
    );
    expect(label).toContain("MSCI World");
    expect(label).toContain("5");
  });
});

describe("an unrealized-gain rule reads its own unit", () => {
  it("quotes a percentage when the threshold is one", () => {
    const label = ruleLabel(
      rule({ kind: "UNREALIZED_GAIN", gainUnit: "PERCENT", gainThresholdPct: 12, balanceThresholdCents: null }),
      t
    );
    expect(label).toContain("12");
  });

  it("quotes an amount when the threshold is one", () => {
    const label = ruleLabel(
      rule({ kind: "UNREALIZED_GAIN", gainUnit: "AMOUNT", gainThresholdPct: null, balanceThresholdCents: BigInt(100000) }),
      t
    );
    expect(label).toContain("1");
  });

  it("says the whole portfolio when no account is attached", () => {
    // accountId null is valid input for this kind alone - it means every
    // investment and crypto account - so the sentence must not fall back to
    // the "?" every other kind uses for a deleted row.
    const whole = ruleLabel(
      rule({ kind: "UNREALIZED_GAIN", account: null, gainUnit: "AMOUNT", balanceThresholdCents: BigInt(100000) }),
      t
    );
    const scoped = ruleLabel(
      rule({ kind: "UNREALIZED_GAIN", gainUnit: "AMOUNT", balanceThresholdCents: BigInt(100000) }),
      t
    );
    expect(whole).not.toEqual(scoped);
  });
});

describe("a row whose target was deleted out from under it", () => {
  it("prints a placeholder rather than crashing or printing undefined", () => {
    // Every FK here is onDelete: Cascade, so this is defensive rather than
    // expected - but "undefined" reaching a notification would be worse than
    // a question mark.
    for (const kind of ["ACCOUNT_BALANCE", "HOLDING_PRICE", "BUDGET_OVERRUN"] as const) {
      const label = ruleLabel(rule({ kind, account: null, holding: null, category: null }), t);
      expect(label).toContain("?");
      expect(label).not.toContain("undefined");
    }
  });
});
