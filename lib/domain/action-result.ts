/**
 * What a Server Action hands back to the form that called it.
 *
 * Expected failures are RETURNED, never thrown. Next replaces a thrown Server
 * Action error with an opaque digest in production, so a sentence written for
 * the user reached them in development and nothing at all once deployed - the
 * single most repeated defect in this repository's history. A failure carries
 * a stable key the caller translates, never a sentence, so the same action
 * reads correctly in every locale.
 *
 * Authorization failures are the exception and keep throwing: a caller
 * reaching for something that is not theirs is not an expected outcome, and
 * must not get a readable explanation of why.
 *
 * `E` narrows the error keys per action, so a component can map every one of
 * them to a message and the compiler notices a key nobody translates.
 */
export type ActionResult<T = void, E extends string = string> =
  | { ok: true; data: T }
  | { ok: false; error: E | "unexpected"; detail?: string };

export function actionOk(): ActionResult<void, never>;
export function actionOk<T>(data: T): ActionResult<T, never>;
export function actionOk<T>(data?: T): ActionResult<T | undefined, never> {
  return { ok: true, data };
}

export function actionError<E extends string>(error: E, detail?: string): ActionResult<never, E> {
  return detail === undefined ? { ok: false, error } : { ok: false, error, detail };
}
