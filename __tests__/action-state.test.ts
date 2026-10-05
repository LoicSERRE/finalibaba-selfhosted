import { describe, expect, it, vi } from "vitest";
import { guardAction } from "@/lib/utils/action-state";
import { actionError, actionOk } from "@/lib/domain/action-result";

describe("guardAction", () => {
  it("passes a success through untouched", async () => {
    const action = guardAction(async (n: number) => actionOk(n * 2));
    await expect(action(21)).resolves.toEqual({ ok: true, data: 42 });
  });

  it("passes an expected failure through untouched, detail included", async () => {
    const action = guardAction(async () => actionError("save_failed", "disk full"));
    await expect(action()).resolves.toEqual({ ok: false, error: "save_failed", detail: "disk full" });
  });

  it("turns a THROWN error into the 'unexpected' key instead of rejecting", async () => {
    // What a production form receives when an action throws: an opaque digest.
    // Before this, a form awaiting the action directly either crashed into the
    // error boundary or showed that digest to the user as if it were a message.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const action = guardAction(async () => {
      throw new Error("An error occurred in the Server Components render. digest: 1234");
    });

    await expect(action()).resolves.toEqual({ ok: false, error: "unexpected" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never leaks the thrown message into the result", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await guardAction(async () => {
      throw new Error("connection to 10.0.0.5:5432 refused");
    })();
    expect(JSON.stringify(result)).not.toContain("10.0.0.5");
    spy.mockRestore();
  });
});

describe("actionError", () => {
  it("omits detail entirely when there is none, so results compare cleanly", () => {
    expect(actionError("x")).toEqual({ ok: false, error: "x" });
    expect(Object.keys(actionError("x"))).not.toContain("detail");
  });
});
