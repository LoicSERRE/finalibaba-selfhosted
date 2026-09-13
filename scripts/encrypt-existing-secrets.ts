/**
 * Manual/dry-run front end for the same backfill `instrumentation.ts` runs on
 * every server start.
 *
 * The automatic path is the one that matters and needs nothing from anyone;
 * this exists to look before leaping on a production instance, and to re-run
 * it deliberately after a key change. It needs `tsx`, a devDependency, so it
 * runs from a dev checkout rather than the production image - which is exactly
 * why the real migration is the startup hook and not this file.
 *
 *   pnpm exec tsx scripts/encrypt-existing-secrets.ts          # counts only
 *   pnpm exec tsx scripts/encrypt-existing-secrets.ts --apply  # writes
 */
import { prisma } from "@/lib/db/prisma";
import { backfillEncryptedSecrets } from "@/lib/services/secret-backfill";
import { isEncrypted } from "@/lib/domain/crypto-at-rest";

const APPLY = process.argv.includes("--apply");

async function countPending(): Promise<number> {
  const [institutions, users, settings, links, keys, invites] = await Promise.all([
    prisma.institution.findMany({ select: { woobLogin: true, woobPassword: true, trPhone: true, trPin: true } }),
    prisma.user.findMany({ select: { totpSecret: true } }),
    prisma.userSettings.findMany({ select: { smtpPassword: true, ntfyAuthToken: true } }),
    prisma.shareLink.findMany({ select: { token: true } }),
    prisma.apiKey.findMany({ select: { token: true } }),
    prisma.invitation.findMany({ select: { token: true } }),
  ]);

  const values = [...institutions, ...users, ...settings, ...links, ...keys, ...invites].flatMap((row) =>
    Object.values(row)
  );
  return values.filter((v) => typeof v === "string" && v !== "" && !isEncrypted(v)).length;
}

async function main() {
  if (!APPLY) {
    const pending = await countPending();
    console.log(
      pending === 0
        ? "Nothing to do: every stored credential is already encrypted."
        : `${pending} value(s) still in clear. Re-run with --apply, or just deploy - the app encrypts them at startup.`
    );
  } else {
    const { encrypted, alreadyDone } = await backfillEncryptedSecrets();
    console.log(`${alreadyDone} already encrypted, ${encrypted} encrypted now.`);
    if (encrypted > 0) {
      console.log("Restart the sync service so it reads them with the same key: docker compose restart sync");
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
