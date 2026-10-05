import type { ActionResult } from "@/lib/domain/action-result";

/**
 * Wraps a Server Action for a client form so that EVERY outcome comes back as
 * an ActionResult, including the ones the action never meant to produce.
 *
 * A thrown error - a lost connection, an expired session, a bug - reaches the
 * browser as an opaque digest, and a form that awaits the action directly
 * either crashes into the error boundary or shows that digest as if it were a
 * message. Here it becomes `{ ok: false, error: "unexpected" }`, which the form
 * renders like any other failure. The original is still logged, so nothing is
 * hidden from someone debugging.
 */
export function guardAction<Args extends unknown[], T, E extends string>(
  action: (...args: Args) => Promise<ActionResult<T, E>>
): (...args: Args) => Promise<ActionResult<T, E>> {
  return async (...args: Args) => {
    try {
      return await action(...args);
    } catch (error) {
      console.error("Server Action failed unexpectedly:", error);
      return { ok: false, error: "unexpected" };
    }
  };
}
