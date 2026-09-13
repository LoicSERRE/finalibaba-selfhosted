import { prisma } from "@/lib/db/prisma";

/**
 * Attempt counters that survive a restart.
 *
 * The in-memory map this replaces was reset every time the container
 * restarted, which the post-v2.0 audit noted and accepted. On an
 * internet-exposed instance that is a real hole rather than a footnote:
 * anything that can crash-loop the app also clears the brake on guessing a
 * password, and `restart: unless-stopped` makes a crash loop cheap to cause.
 *
 * Deliberately a table rather than Redis. This project's whole promise is one
 * `docker compose up`, and a second service to run and secure costs more than
 * a counter is worth. The row count stays tiny - one per (ip, username) pair
 * inside the window, swept as it goes.
 */

const WINDOW_MS = 15 * 60 * 1000;

/** Max attempts inside the window, per key. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const INVITATION_MAX_ATTEMPTS = 10;

/**
 * Counts one attempt against `key`. Returns false once the limit is reached.
 *
 * **Fails OPEN if the database is unreachable**, and that is a deliberate
 * trade worth naming: a limiter that fails closed would turn a database blip
 * into a total lockout of every user, including the admin who needs to log in
 * to fix it. The login path it guards already requires a correct password, so
 * failing open degrades to the protection that existed before this file.
 */
export async function consumeAttempt(key: string, max: number): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + WINDOW_MS);

  try {
    const existing = await prisma.rateLimit.findUnique({ where: { key } });

    // Absent or expired: start a fresh window. `upsert` rather than `create`
    // so two requests racing on the same key cannot collide on the primary
    // key - the second simply increments what the first wrote.
    if (!existing || existing.resetAt <= now) {
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, resetAt },
        update: { count: 1, resetAt },
      });
      return true;
    }

    if (existing.count >= max) return false;

    await prisma.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  } catch (e) {
    console.error("[rate-limit] could not record an attempt, allowing it:", e);
    return true;
  }
}

/**
 * Clears a key, called after a success so a legitimate user who mistyped twice
 * is not still one attempt from a lockout an hour later.
 */
export async function clearAttempts(key: string): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({ where: { key } });
  } catch {
    // A counter that outlives its window expires on its own; nothing to do.
  }
}

/**
 * Drops rows whose window has closed.
 *
 * Called from the same startup hook as the encryption backfill rather than on
 * a schedule: the table only grows while an attack is in progress, and a
 * restart is the one moment nothing is racing on it.
 */
export async function sweepExpiredRateLimits(): Promise<number> {
  try {
    const { count } = await prisma.rateLimit.deleteMany({ where: { resetAt: { lte: new Date() } } });
    return count;
  } catch {
    return 0;
  }
}
