/**
 * Give up on a promise that may never settle, with a reason the UI can show.
 *
 * Written for the WebAuthn registration flow, where a step that hangs leaves a
 * button spinning with no way out but reloading the page - reported twice from
 * a real instance, and never reproducible here. Whatever the cause turns out
 * to be, "this took too long, here is what to try" beats a spinner forever.
 *
 * Deliberately does not cancel the underlying work: a Server Action cannot be
 * aborted from here, and a WebAuthn ceremony is owned by the browser. This
 * only stops the UI waiting on it. If the original promise settles later, its
 * result is ignored, which is why callers must treat a timeout as final.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
