/**
 * Runs once per server start, before the first request is served.
 *
 * The only thing here is the encryption backfill, and it lives at startup
 * rather than in a script an operator has to remember: "deploy, then run this
 * command" is a migration that eventually does not get run, and until it does
 * the credentials it was meant to protect are still in clear in every backup.
 * `docker compose up -d` is the whole deployment story this project promises,
 * so the migration has to fit inside it.
 *
 * It is idempotent by construction (see lib/services/secret-backfill.ts): a
 * migrated instance does three cheap SELECTs and writes nothing, so paying for
 * it on every boot costs milliseconds.
 */
export async function register() {
  // instrumentation also runs on the Edge runtime, where Prisma cannot.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { backfillEncryptedSecrets } = await import("@/lib/services/secret-backfill");

  try {
    const { encrypted, alreadyDone } = await backfillEncryptedSecrets();
    if (encrypted > 0) {
      console.log(
        `[encryption] Encrypted ${encrypted} stored credential(s) at rest. ` +
          `Restart the sync service so it reads them with the same key: docker compose restart sync`
      );
    } else if (alreadyDone > 0) {
      console.log(`[encryption] ${alreadyDone} stored credential(s) already encrypted.`);
    }
  } catch (e) {
    // Deliberately not fatal. The app works either way - an unencrypted value
    // reads back untouched - so refusing to boot would turn "your credentials
    // are no better protected than yesterday" into "your instance is down",
    // which is strictly worse. Loud enough to be found in the logs instead,
    // because the failure mode this guards against is the silent one: rows
    // that quietly stay in clear while everyone assumes otherwise.
    console.error(
      "[encryption] Could not encrypt stored credentials at rest. They remain readable " +
        "in the database and in backups until this succeeds. Cause:",
      e
    );
  }
}
