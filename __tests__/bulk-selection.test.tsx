// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The ledger's selection UI (v2.14): what is selected is what gets sent, the
 * page box reflects a partial selection, and a successful edit clears the
 * selection and offers undo with the token the action returned.
 */

const translate = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;
vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const actions = vi.hoisted(() => ({
  bulkCategorizeTransactions: vi.fn(),
  bulkMarkInternalTransfers: vi.fn(),
  undoDeletion: vi.fn(),
}));
vi.mock("@/lib/actions/transactions", () => ({
  bulkCategorizeTransactions: actions.bulkCategorizeTransactions,
  bulkMarkInternalTransfers: actions.bulkMarkInternalTransfers,
}));
vi.mock("@/lib/actions/undo", () => ({ undoDeletion: actions.undoDeletion }));

import { BulkSelectionProvider, BulkToolbar, RowSelectCheckbox } from "@/components/transactions/bulk-selection";
import { Toaster } from "@/components/ui/toast";

const IDS = ["t1", "t2", "t3"];
const CATEGORIES = [{ id: "c1", name: "Food" }];

function renderLedger() {
  render(
    <>
      <Toaster />
      <BulkSelectionProvider pageIds={IDS}>
        <BulkToolbar pageIds={IDS} categories={CATEGORIES} />
        {IDS.map((id) => <RowSelectCheckbox key={id} id={id} label={`row ${id}`} />)}
      </BulkSelectionProvider>
    </>
  );
}

const rowBox = (id: string) => {
  const name = "selectRow:" + JSON.stringify({ label: "row " + id });
  return screen.getByRole("checkbox", { name }) as HTMLInputElement;
};
const pageBox = () => screen.getAllByRole("checkbox").find((el) => !el.hasAttribute("data-row-select")) as HTMLInputElement;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("selection", () => {
  it("shows the toolbar only once something is selected", () => {
    renderLedger();
    expect(screen.queryByRole("button", { name: /apply/ })).toBeNull();
    fireEvent.click(rowBox("t2"));
    expect(screen.getByText(/selected:/).textContent).toContain('"count":1');
    expect(screen.getByRole("button", { name: /apply/ })).toBeTruthy();
  });

  it("marks the page box indeterminate for a partial selection, checked for all", () => {
    renderLedger();
    fireEvent.click(rowBox("t1"));
    expect(pageBox().indeterminate).toBe(true);
    expect(pageBox().checked).toBe(false);
    fireEvent.click(pageBox());
    expect(IDS.every((id) => rowBox(id).checked)).toBe(true);
    expect(pageBox().checked).toBe(true);
    fireEvent.click(pageBox());
    expect(IDS.some((id) => rowBox(id).checked)).toBe(false);
  });
});

describe("applying", () => {
  it("sends exactly the selection, null for 'uncategorized', then clears and offers undo", async () => {
    actions.bulkCategorizeTransactions.mockResolvedValueOnce({ ok: true, data: { updated: 2, skippedSplit: 1, undoToken: "tok" } });
    renderLedger();
    fireEvent.click(rowBox("t1"));
    fireEvent.click(rowBox("t3"));
    fireEvent.click(screen.getByRole("button", { name: /apply/ }));
    await act(async () => {});
    expect(actions.bulkCategorizeTransactions).toHaveBeenCalledWith(["t1", "t3"], null);
    expect(screen.getByText(/categorized:/).textContent).toContain("skippedSplit");
    expect(rowBox("t1").checked).toBe(false);
    actions.undoDeletion.mockResolvedValueOnce({ ok: true, data: undefined });
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await act(async () => {});
    expect(actions.undoDeletion).toHaveBeenCalledWith("tok");
  });

  it("applies the picked category", async () => {
    actions.bulkCategorizeTransactions.mockResolvedValueOnce({ ok: true, data: { updated: 1, skippedSplit: 0, undoToken: "tok" } });
    renderLedger();
    fireEvent.click(rowBox("t2"));
    fireEvent.change(screen.getByRole("combobox", { name: "categoryLabel" }), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/ }));
    await act(async () => {});
    expect(actions.bulkCategorizeTransactions).toHaveBeenCalledWith(["t2"], "c1");
  });

  it("keeps the selection and says so when the edit fails", async () => {
    actions.bulkMarkInternalTransfers.mockResolvedValueOnce({ ok: false, error: "invalid_selection" });
    renderLedger();
    fireEvent.click(rowBox("t1"));
    fireEvent.click(screen.getByRole("button", { name: /markTransfer/ }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("failed");
    expect(rowBox("t1").checked).toBe(true);
  });
});
