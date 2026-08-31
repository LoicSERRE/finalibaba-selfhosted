import { describe, expect, it, vi } from "vitest";
import { withTimeout, TimeoutError } from "@/lib/utils/with-timeout";

// Written for a WebAuthn registration that hung with no way out but reloading
// the page, reported twice from a real instance and never reproducible here.
// Whatever the cause, the UI must stop waiting and say something.

describe("withTimeout", () => {
  it("passes a value straight through when it arrives in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "too slow")).resolves.toBe("ok");
  });

  it("passes the original rejection through, rather than masking it as a timeout", async () => {
    // A real error is far more useful than "it took too long", so it must win
    // whenever there is one.
    await expect(
      withTimeout(Promise.reject(new Error("real failure")), 1000, "too slow"),
    ).rejects.toThrow("real failure");
  });

  it("rejects with the caller's message once the deadline passes", async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise(() => {}), 5000, "the server did not respond");
      const assertion = expect(pending).rejects.toThrow("the server did not respond");
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with a TimeoutError, so a caller can tell it apart", async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise(() => {}), 5000, "too slow");
      const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears its timer when the promise settles first", async () => {
    // Otherwise every wrapped call would hold a timer until its deadline, and
    // these wrap a flow the user may repeat several times in a row.
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    try {
      await withTimeout(Promise.resolve("ok"), 60_000, "too slow");
      expect(clear).toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      vi.useRealTimers();
    }
  });

  it("ignores a late result instead of settling twice", async () => {
    vi.useFakeTimers();
    try {
      let release!: (v: string) => void;
      const slow = new Promise<string>((r) => {
        release = r;
      });
      const pending = withTimeout(slow, 1000, "too slow");
      const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;

      // The underlying work cannot be cancelled - a Server Action has no
      // abort, and a WebAuthn ceremony belongs to the browser - so it may
      // still finish. It must not resurrect a promise already rejected.
      release("late");
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }
  });
});
