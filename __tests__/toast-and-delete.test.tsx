// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The toast stack and the delete button that raises it (v2.13). What matters
 * is behaviour a user relies on and a refactor could quietly break: a toast
 * that leaves while someone is reaching for "Annuler", an undoable deletion
 * that still asks for confirmation (or worse, an irreversible one that stops
 * asking), and an undo whose failure is swallowed.
 */

// Echoes interpolation values, so "deletedNamed" with { name } is checkable.
const translate = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;
vi.mock("next-intl", () => ({ useTranslations: () => translate }));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { undoDeletion } = vi.hoisted(() => ({ undoDeletion: vi.fn() }));
vi.mock("@/lib/actions/undo", () => ({ undoDeletion }));

import { Toaster, toast } from "@/components/ui/toast";
import { DeleteButton } from "@/components/shared/delete-button";

beforeEach(() => {
  vi.useFakeTimers();
  undoDeletion.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
  cleanup();
});

const region = () => screen.getByRole("region", { name: "notifications" });
const flush = () => act(async () => {});

describe("the toast stack", () => {
  it("is a permanent polite live region, so insertions are announced", () => {
    render(<Toaster />);
    expect(region().getAttribute("aria-live")).toBe("polite");
    act(() => void toast({ message: "Saved" }));
    expect(region().textContent).toContain("Saved");
  });

  it("leaves after 4s, or 8s when it carries an action", () => {
    render(<Toaster />);
    act(() => void toast({ message: "plain" }));
    act(() => void toast({ message: "with action", action: { label: "Undo", onClick: () => {} } }));
    act(() => void vi.advanceTimersByTime(4100));
    expect(region().textContent).not.toContain("plain");
    expect(region().textContent).toContain("with action");
    act(() => void vi.advanceTimersByTime(4000));
    expect(region().textContent).not.toContain("with action");
  });

  it("holds while hovered, and resumes the remaining time after", () => {
    render(<Toaster />);
    act(() => void toast({ message: "held" }));
    const card = screen.getByText("held").parentElement!;
    act(() => void vi.advanceTimersByTime(3000));
    fireEvent.mouseEnter(card);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(region().textContent).toContain("held");
    fireEvent.mouseLeave(card);
    act(() => void vi.advanceTimersByTime(900));
    expect(region().textContent).toContain("held");
    act(() => void vi.advanceTimersByTime(200));
    expect(region().textContent).not.toContain("held");
  });

  it("marks errors as alerts and keeps at most three", () => {
    render(<Toaster />);
    act(() => void toast({ message: "bad", tone: "error" }));
    expect(screen.getByRole("alert").textContent).toContain("bad");
    act(() => { for (const n of [1, 2, 3, 4]) toast({ message: `n${n}` }); });
    expect(region().textContent).not.toContain("bad");
    expect(region().textContent).not.toContain("n1");
    expect(region().textContent).toContain("n4");
  });

  it("runs its action once and then leaves", async () => {
    const onClick = vi.fn();
    render(<Toaster />);
    act(() => void toast({ message: "m", action: { label: "Undo", onClick } }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await flush();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(region().textContent).not.toContain("m");
  });
});

describe("DeleteButton", () => {
  const ok = { ok: true as const, data: { undoToken: "tok-1" } };

  /** An undoable button, already clicked and settled: the toast is up. */
  async function deletedWithUndo() {
    render(<><Toaster /><DeleteButton undoable iconOnly label="delete" onDelete={async () => ok} /></>);
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await flush();
  }

  it("deletes an undoable item on the first click, with no dialog, and offers undo", async () => {
    const onDelete = vi.fn(async () => ok);
    render(<><Toaster /><DeleteButton undoable iconOnly label="delete" deletedMessage="Deleted: Rent" onDelete={onDelete} /></>);
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    // Checked before the deletion settles too: a dialog that flashes open and
    // closes again once the delete returns is still a dialog.
    expect(screen.queryByRole("dialog")).toBeNull();
    await flush();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(region().textContent).toContain("Deleted: Rent");
    expect(screen.getByRole("button", { name: "undo" })).toBeTruthy();
  });

  it("spends the token on undo, then confirms and refreshes", async () => {
    undoDeletion.mockResolvedValueOnce({ ok: true, data: undefined });
    await deletedWithUndo();
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await flush();
    expect(undoDeletion).toHaveBeenCalledWith("tok-1");
    expect(region().textContent).toContain("restored");
    expect(refresh).toHaveBeenCalled();
  });

  it("says why an undo failed instead of swallowing it", async () => {
    undoDeletion.mockResolvedValueOnce({ ok: false, error: "undo_conflict" });
    await deletedWithUndo();
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("undoConflict");
  });

  it("keeps the confirmation for anything not undoable", async () => {
    const onDelete = vi.fn(async () => {});
    render(<><Toaster /><DeleteButton iconOnly label="delete" onDelete={onDelete} /></>);
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await flush();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
