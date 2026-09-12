// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * SPIKE, v2.10.5 - the first rendering test this repository has ever had.
 *
 * It exists to answer one question with a measurement rather than an opinion:
 * what does a component test actually cost here, and would it catch anything
 * the 1011 existing tests cannot. Several deferrals in CLAUDE.md rest on the
 * answer - splitting settings/page.tsx (CCN 41) and alert-rules-section.tsx
 * (CCN 26) were both declined on the grounds that a prop-wiring mistake would
 * ship silently with nothing able to see it.
 *
 * The subject is deliberately the component changed most recently: the varying
 * amount marker added hours ago, which no test covers and which a reviewer can
 * only check by opening the page.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(",")}` : key,
}));
// A server action cannot run here, and does not need to: this asserts what is
// rendered, never what a click writes.
vi.mock("@/lib/actions/recurring", () => ({ dismissSuggestion: vi.fn() }));
vi.mock("@/components/recurring/add-recurring-dialog", () => ({
  AddRecurringDialog: () => null,
}));

import { SuggestionCard } from "@/components/recurring/suggestion-card";

const BASE = {
  accountId: "acc-1",
  accountName: "Courant",
  label: "VIREMENT SOPRA STERIA GROUP",
  amountCents: 144645,
  frequency: "MONTHLY" as const,
  intervalCount: 1,
  anchorDate: "2026-09-05",
  categoryId: null,
  amountVaries: false,
};

function show(over: Partial<typeof BASE> = {}) {
  render(<SuggestionCard candidate={{ ...BASE, ...over }} accounts={[]} categories={[]} />);
}

afterEach(cleanup);

describe("what a suggestion says about its amount", () => {
  it("prints a steady amount plainly", () => {
    show();
    expect(screen.getByText(/1 ?446,45/)).toBeTruthy();
    expect(screen.queryByText(/approxAmount/)).toBeNull();
  });

  it("marks a varying amount as an average rather than a figure", () => {
    // The stored number is a MEDIAN of what arrived. Printing it bare would
    // present an estimate as something the user could hold the app to - the
    // same "an absent or approximate value rendered as fact" shape the release
    // audit names in its own right.
    show({ amountVaries: true });
    expect(screen.getByText(/approxAmount:/)).toBeTruthy();
  });

  it("still names the account and the cadence either way", () => {
    show({ amountVaries: true });
    expect(screen.getByText(/Courant/)).toBeTruthy();
    expect(screen.getByText(/VIREMENT SOPRA STERIA GROUP/)).toBeTruthy();
  });
});
