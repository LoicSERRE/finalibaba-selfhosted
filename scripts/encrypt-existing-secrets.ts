/**
 * Encrypts the credential columns of an instance that predates v2.10.6.
 *
 * Everything written from now on is encrypted by the actions themselves; this
 * is only for rows already sitting in the database. Until it runs, those rows
 * stay readable - `decryptSecret` returns an unprefixed value untouched - so
 * an instance keeps working before, during and after, and the migration can be
 * interrupted and re-run without consequence.
 *
 * Dry run by default. `--apply` writes.
 *
 *   docker compose exec app pnpm exec tsx scripts/encrypt-existing-secrets.ts
 *   docker compose exec app pnpm exec tsx scripts/encrypt-existing-secrets.ts --apply
 *
 * It must run with the SAME environment the app uses: the key comes from
 * ENCRYPTION_KEY, or from NEXTAUTH_SECRET when that is unset, so running it
 * from a shell that lacks them would encrypt under a key nothing else has.
 * That is why the command above goes through the container rather than a
 * local terminal.
 *
 * **Take a backup first.** Not because this is expected to fail - it skips
 * anything already encrypted and writes each row in its own statement - but
 * because the one input it cannot recover from is a key that changes
 * afterwards, and a backup taken before is the only thing that helps then.
 */
import { prisma } from "@/lib/db/prisma";
import { encryptSecret, isEncrypted } from "@/lib/domain/crypto-at-rest";

const APPLY = process.argv.includes("--apply");

/** The only two operations this needs, so each model can be passed by value. */
type Table = {
  findMany: (args: { select: Record<string, boolean> }) => Promise<Record<string, unknown>[]>;
  update: (args: { where: { id: string }; data: Record<string, string> }) => Promise<unknown>;
};

/** What one row needs: the columns still in clear, and how many already are not. */
function pendingFor(row: Record<string, unknown>, fields: readonly string[]) {
  const data: Record<string, string> = {};
  let already = 0;
  for (const field of fields) {
    const value = row[field];
    if (typeof value !== "string" || value === "") continue;
    if (isEncrypted(value)) {
      already += 1;
      continue;
    }
    data[field] = encryptSecret(value)!;
  }
  return { data, already };
}

async function processTable(label: string, table: Table, fields: readonly string[]) {
  const rows = await table.findMany({
    select: Object.fromEntries([["id", true], ...fields.map((f) => [f, true])]),
  });

  let pending = 0;
  let already = 0;
  for (const row of rows) {
    const result = pendingFor(row, fields);
    already += result.already;
    const changed = Object.keys(result.data);
    if (changed.length === 0) continue;
    pending += changed.length;
    console.log(`  ${label} ${String(row.id)}: ${changed.join(", ")}`);
    if (APPLY) await table.update({ where: { id: String(row.id) }, data: result.data });
  }
  return { pending, already };
}

async function main() {
  if (!APPLY) {
    console.log("DRY RUN - nothing is written. Re-run with --apply once the counts look right.\n");
  }

  // Listed explicitly rather than looked up by model name: indexing the
  // client dynamically needs a cast that defeats the type-checking which is
  // the only thing verifying these column names exist at all.
  const results = [
    await processTable("Institution", prisma.institution, [
      "woobLogin",
      "woobPassword",
      "trPhone",
      "trPin",
    ]),
    await processTable("User", prisma.user, ["totpSecret"]),
    await processTable("UserSettings", prisma.userSettings, ["smtpPassword", "ntfyAuthToken"]),
  ];

  const totalPending = results.reduce((n, r) => n + r.pending, 0);
  const totalAlready = results.reduce((n, r) => n + r.already, 0);

  console.log();
  console.log(`${totalAlready} value(s) already encrypted, left alone.`);
  console.log(
    APPLY
      ? `${totalPending} value(s) encrypted.`
      : `${totalPending} value(s) would be encrypted. Re-run with --apply.`
  );
  if (APPLY && totalPending > 0) {
    console.log(
      "\nThe sync service reads these columns too. Restart it so it picks up the same key:\n" +
        "  docker compose restart sync"
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
