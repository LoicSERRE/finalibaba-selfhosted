/**
 * Runtime validation of Server Action / Route Handler arguments.
 *
 * A Server Action is a public POST endpoint, and TypeScript's parameter types
 * are erased at runtime - so a parameter declared `id: string` can arrive as
 * ANY JSON value the caller chooses, including an object. Passed straight into
 * a Prisma `where`, `{ "not": "x" }` becomes a *filter operator* rather than a
 * value, which turned an ownership check that counts "my rows with this id"
 * into "my rows with any id but this one" and let one user's call touch
 * another's data (audited: the operator-injection class). Prisma rejects an
 * object in a *unique* `where` (`findUnique`/`delete`), but not in the
 * `findFirst`/`count`/`deleteMany`/`updateMany` filters the guards use.
 *
 * So every id-shaped argument is narrowed to a real string before it can reach
 * a query. These throw the same opaque "Invalid request." as a missing row, so
 * a probe cannot tell a rejected type from a forbidden id.
 */

const MAX_ID_LENGTH = 256;

export class InvalidActionInputError extends Error {
  constructor(message = "Invalid request.") {
    super(message);
    this.name = "InvalidActionInputError";
  }
}

/** Narrow an argument to a non-empty, sanely-bounded string, or throw. */
export function assertId(value: unknown): string {
  if (typeof value !== "string") throw new InvalidActionInputError();
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) throw new InvalidActionInputError();
  return trimmed;
}

/** Same for an optional id: `null`/`undefined`/`""` pass through as `null`. */
export function assertOptionalId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return assertId(value);
}

/** Narrow an argument to an array of valid ids (deduplicated), or throw. */
export function assertIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new InvalidActionInputError();
  return [...new Set(value.map(assertId))];
}

/** True for the opaque type/shape rejection above, for callers that translate it. */
export function isInvalidActionInput(error: unknown): error is InvalidActionInputError {
  return error instanceof InvalidActionInputError;
}
