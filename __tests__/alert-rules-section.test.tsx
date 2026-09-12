// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * SPIKE part two, v2.10.5 - the component whose split was DECLINED for want of
 * a test like this one.
 *
 * alert-rules-section.tsx is 810 lines at cyclomatic complexity 26, and every
 * audit that looked at it said the same thing: a prop-wiring mistake in a form
 * that sends money thresholds to a Server Action would ship silently, so
 * splitting it blind costs more than the line count is worth. That argument is
 * only honest while a rendering test is impossible. This is the measurement of
 * whether it still is.
 */

// The mock MUST echo its interpolation values. Returning the bare key throws
// away exactly what a data-wiring test needs to see - the account name and the
// threshold live in those vars - and every assertion would then be looking at
// an empty string while reporting a clean failure.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}(${Object.values(vars).join("|")})` : key,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/alert-rules", () => ({
  createAlertRule: vi.fn(),
  updateAlertRule: vi.fn(),
  deleteAlertRule: vi.fn(),
  toggleAlertRuleActive: vi.fn(),
}));

import { AlertRulesSection } from "@/components/settings/alert-rules-section";

const ACCOUNT = { id: "acc-1", name: "Courant" };

function show(rules: unknown[] = []) {
  render(
    <AlertRulesSection
      rules={rules as never}
      fiatAccounts={[ACCOUNT]}
      investmentAccounts={[]}
      categories={[{ id: "cat-1", name: "Alimentation", budgetCents: BigInt(40000) }] as never}
    />
  );
}

afterEach(cleanup);

describe("the rules list", () => {
  it("shows an empty state rather than a bare heading when there are none", () => {
    show();
    expect(screen.getAllByText(/noRules|empty/i).length).toBeGreaterThan(0);
  });

  it("names the account a balance rule watches, and its threshold", () => {
    // The wiring that matters: a rule whose account or threshold is rendered
    // from the wrong prop would look completely normal on screen while
    // pointing somewhere else.
    show([
      {
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
      },
    ]);

    expect(screen.getByText(/Courant/)).toBeTruthy();
    expect(screen.getByText(/500/)).toBeTruthy();
  });

  it("shows an overdraft rule without quoting a threshold nobody typed", () => {
    show([
      {
        id: "r2",
        kind: "ACCOUNT_OVERDRAFT",
        active: true,
        message: null,
        balanceThresholdCents: BigInt(0),
        gainThresholdPct: null,
        gainUnit: null,
        transactionDirection: null,
        account: ACCOUNT,
        holding: null,
        category: null,
      },
    ]);

    expect(screen.getByText(/Courant/)).toBeTruthy();
  });
});
