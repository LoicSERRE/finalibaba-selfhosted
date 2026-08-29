import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe, notify } from "@/lib/services/realtime-bus";

// The in-process pub/sub behind the SSE "something changed, go re-fetch"
// signal. Small, but it is what keeps one user's Trade Republic sync from
// refreshing every other user's open tabs: it was a single flat Set before
// v2.0, and the per-user keying is the whole point of the module now.
//
// Timers are faked because the bus debounces by 2s; without that these tests
// would either sleep or assert nothing.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Advances past the module's own DEBOUNCE_MS. */
const flush = () => vi.advanceTimersByTime(2500);

describe("realtime bus", () => {
  it("delivers a notify to that user's listener", () => {
    const seen = vi.fn();
    const off = subscribe("user-a", seen);

    notify("user-a");
    expect(seen).not.toHaveBeenCalled(); // debounced, not synchronous
    flush();

    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("never delivers one user's signal to another", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe("user-a", a);
    const offB = subscribe("user-b", b);

    notify("user-a");
    flush();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("fans out to every tab the same user has open", () => {
    const tab1 = vi.fn();
    const tab2 = vi.fn();
    const off1 = subscribe("user-a", tab1);
    const off2 = subscribe("user-a", tab2);

    notify("user-a");
    flush();

    expect(tab1).toHaveBeenCalledTimes(1);
    expect(tab2).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });

  it("coalesces a burst into one broadcast", () => {
    // Cash and portfolio both changing from the same trade must not make an
    // open tab call router.refresh() three times in the same second.
    const seen = vi.fn();
    const off = subscribe("user-a", seen);

    notify("user-a");
    notify("user-a");
    notify("user-a");
    flush();

    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("debounces per user, so one user's burst cannot swallow another's signal", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe("user-a", a);
    const offB = subscribe("user-b", b);

    notify("user-a");
    notify("user-b");
    flush();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("accepts a new signal once the debounce window has passed", () => {
    const seen = vi.fn();
    const off = subscribe("user-a", seen);

    notify("user-a");
    flush();
    notify("user-a");
    flush();

    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });

  it("stops delivering after unsubscribe", () => {
    const seen = vi.fn();
    const off = subscribe("user-a", seen);
    off();

    notify("user-a");
    flush();

    expect(seen).not.toHaveBeenCalled();
  });

  it("unsubscribing one tab leaves the other subscribed", () => {
    const tab1 = vi.fn();
    const tab2 = vi.fn();
    const off1 = subscribe("user-a", tab1);
    const off2 = subscribe("user-a", tab2);

    off1();
    notify("user-a");
    flush();

    expect(tab1).not.toHaveBeenCalled();
    expect(tab2).toHaveBeenCalledTimes(1);
    off2();
  });

  it("notifying a user with no listeners is a no-op, not a throw", () => {
    expect(() => {
      notify("nobody-here");
      flush();
    }).not.toThrow();
  });
});
