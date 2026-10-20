// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { startScrambling } from "@/components/layout/discretion-scramble";
import { SCRAMBLED_ATTRIBUTE } from "@/lib/domain/discretion";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

/**
 * Discretion's DOM side (v2.18) edits text nodes React owns. These render
 * through real React, so the nodes carry React's own hydration markers - the
 * one thing the scrambler trusts before touching a node.
 */

const AMOUNT = formatCurrency(123456); // "1 234,56 €"
const PERCENT = formatPercent(0.052);
// AMOUNT's digits, whatever separator sits between them.
const SCRAMBLED_AWAY = /1.234,56/;

// MutationObserver callbacks are microtasks.
const flush = () => act(async () => {});

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  cleanup();
  vi.useRealTimers();
});

function Row({ cents }: Readonly<{ cents: number }>) {
  return (
    <p data-testid="row" className="amount">
      Solde : {formatCurrency(cents)} ({PERCENT})
    </p>
  );
}

describe("startScrambling", () => {
  it("replaces the figures of every target and marks it, leaving the rest alone", () => {
    const { getByTestId } = render(
      <>
        <Row cents={123456} />
        <span data-testid="plain">{AMOUNT}</span>
      </>
    );
    stop = startScrambling(document.body, "salt");

    const row = getByTestId("row");
    expect(row.textContent).not.toMatch(SCRAMBLED_AWAY);
    expect(row.textContent).toContain("Solde : ");
    expect(row.textContent).toContain(PERCENT);
    expect(row.hasAttribute(SCRAMBLED_ATTRIBUTE)).toBe(true);
    // Not a target: untouched.
    expect(getByTestId("plain").textContent).toBe(AMOUNT);
    expect(getByTestId("plain").hasAttribute(SCRAMBLED_ATTRIBUTE)).toBe(false);
  });

  it("restores the real text when stopped", () => {
    const { getByTestId } = render(<Row cents={123456} />);
    stop = startScrambling(document.body, "salt");
    stop();
    stop = undefined;
    expect(getByTestId("row").textContent).toBe(`Solde : ${AMOUNT} (${PERCENT})`);
    expect(getByTestId("row").hasAttribute(SCRAMBLED_ATTRIBUTE)).toBe(false);
  });

  it("scrambles what React re-renders, and restores the newest value", async () => {
    const { getByTestId, rerender } = render(<Row cents={100} />);
    stop = startScrambling(document.body, "salt");

    rerender(<Row cents={987654} />);
    await flush();
    expect(getByTestId("row").textContent).not.toMatch(/9.876,54/);
    expect(getByTestId("row").textContent).toContain(PERCENT);

    stop();
    stop = undefined;
    expect(getByTestId("row").textContent).toBe(`Solde : ${formatCurrency(987654)} (${PERCENT})`);
  });

  it("scrambles targets React mounts later", async () => {
    const { getByTestId, rerender } = render(<div />);
    stop = startScrambling(document.body, "salt");
    rerender(
      <div>
        <span data-testid="later" className="amount">{AMOUNT}</span>
      </div>
    );
    await flush();
    expect(getByTestId("later").textContent).not.toMatch(SCRAMBLED_AWAY);
    expect(getByTestId("later").hasAttribute(SCRAMBLED_ATTRIBUTE)).toBe(true);
  });

  // A streamed Suspense boundary is in the DOM before React hydrates it, and
  // hydration compares text: scrambling it early would be a mismatch.
  it("leaves markup React has not claimed yet blurred, and takes it once claimed", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div><span class="amount">${AMOUNT}</span></div>`;
    const span = document.querySelector("span")!;
    stop = startScrambling(document.body, "salt");
    expect(span.textContent).toBe(AMOUNT);
    expect(span.hasAttribute(SCRAMBLED_ATTRIBUTE)).toBe(false);

    // What React's hydration leaves behind, and nothing else changes in the DOM.
    Object.assign(span, { "__reactFiber$test": {} });
    await vi.advanceTimersByTimeAsync(150);
    expect(span.textContent).not.toMatch(SCRAMBLED_AWAY);
    expect(span.hasAttribute(SCRAMBLED_ATTRIBUTE)).toBe(true);
  });

  // The dashboard's 30-day delta is `({sign}{value}%)`: three text nodes,
  // the `%` in the last one.
  it("keeps a percentage split across text nodes readable", () => {
    const percent = 5.2;
    const { getByTestId } = render(
      <p data-testid="delta" className="amount">
        {formatCurrency(4200)} ({percent > 0 ? "+" : ""}{percent.toFixed(1)}%)
      </p>
    );
    stop = startScrambling(document.body, "salt");
    const text = getByTestId("delta").textContent ?? "";
    expect(text).toMatch(/\(\+5\.2%\)$/);
    expect(text).not.toContain("42,00");
  });

  it("never marks a form field, whose value only the blur can hide", () => {
    render(<input className="amount" defaultValue={AMOUNT} aria-label="x" />);
    stop = startScrambling(document.body, "salt");
    expect(document.querySelector("input")!.hasAttribute(SCRAMBLED_ATTRIBUTE)).toBe(false);
  });
});
