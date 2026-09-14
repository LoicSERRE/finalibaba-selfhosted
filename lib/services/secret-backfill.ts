import { prisma } from "@/lib/db/prisma";
import { encryptSecret, isEncrypted, tokenLookupHash } from "@/lib/domain/crypto-at-rest";

/**
 * Brings an instance that predates encryption-at-rest up to date, in place.
 *
 * Runs from `instrumentation.ts` on every server start rather than as a manual
 * step, because "deploy, then remember to run a script" is a migration that
 * eventually does not get run - and until it does, the credentials it was
 * meant to protect are still sitting in clear in every backup.
 *
 * Safe to run on every boot by construction: it only ever looks at rows whose
 * value is NOT already encrypted, so a migrated instance does three cheap
 * SELECTs and writes nothing. Interrupting it costs nothing either - each row
 * is independent, and a value that was missed is picked up next time.
 *
 * Deliberately NOT a Prisma migration: the key lives in the environment, not
 * the database, and SQL cannot reach it.
 */

/** What a run did, so the caller can say something useful about it. */
export type BackfillResult = { encrypted: number; alreadyDone: number; failures: number };

const CREDENTIAL_TABLES = [
  { label: "Institution", fields: ["woobLogin", "woobPassword", "trPhone", "trPin"] },
  { label: "User", fields: ["totpSecret"] },
  { label: "UserSettings", fields: ["smtpPassword", "ntfyAuthToken"] },
] as const;

type Row = Record<string, unknown>;
type Table = {
  findMany: (args: { select: Record<string, boolean> }) => Promise<Row[]>;
  update: (args: { where: { id: string }; data: Record<string, string> }) => Promise<unknown>;
};

/** The columns of one row still in clear, and how many already were not. */
function pendingFor(row: Row, fields: readonly string[]) {
  const data: Record<string, string> = {};
  let alreadyDone = 0;
  for (const field of fields) {
    const value = row[field];
    if (typeof value !== "string" || value === "") continue;
    if (isEncrypted(value)) {
      alreadyDone += 1;
      continue;
    }
    data[field] = encryptSecret(value)!;
  }
  return { data, alreadyDone };
}

async function backfillTable(table: Table, fields: readonly string[]): Promise<BackfillResult> {
  const rows = await table.findMany({
    select: Object.fromEntries([["id", true], ...fields.map((f) => [f, true])]),
  });

  let encrypted = 0;
  let alreadyDone = 0;
  for (const row of rows) {
    const result = pendingFor(row, fields);
    alreadyDone += result.alreadyDone;
    const changed = Object.keys(result.data);
    if (changed.length === 0) continue;
    await table.update({ where: { id: String(row.id) }, data: result.data });
    encrypted += changed.length;
  }
  return { encrypted, alreadyDone, failures: 0 };
}

/**
 * Tokens need the digest written in the same statement as the ciphertext.
 *
 * Doing them in one update is what keeps a row from ever existing encrypted
 * but unsearchable - which for a share link or an API key means a credential
 * that is live, unusable, and impossible to find again.
 */
async function backfillTokens(table: Table, label: string): Promise<BackfillResult> {
  const rows = await table.findMany({ select: { id: true, token: true, tokenHash: true } });

  let encrypted = 0;
  let alreadyDone = 0;
  for (const row of rows) {
    const token = row.token;
    if (typeof token !== "string" || token === "") continue;
    if (isEncrypted(token) && typeof row.tokenHash === "string" && row.tokenHash !== "") {
      alreadyDone += 1;
      continue;
    }
    // A row can only be hashed from a token still in clear, so a half-migrated
    // row (encrypted, no digest) is not recoverable here and is left for a
    // human rather than silently rewritten into something that never matches.
    if (isEncrypted(token)) {
      console.error(`[encryption] ${label} ${String(row.id)} is encrypted with no tokenHash - it cannot be looked up. Revoke and reissue it.`);
      continue;
    }
    await table.update({
      where: { id: String(row.id) },
      data: { token: encryptSecret(token)!, tokenHash: tokenLookupHash(token) },
    });
    encrypted += 1;
  }
  return { encrypted, alreadyDone, failures: 0 };
}

/** Encrypts whatever is still in clear. Returns what it did. */
export async function backfillEncryptedSecrets(): Promise<BackfillResult> {
  const tables: Record<string, Table> = {
    Institution: prisma.institution as unknown as Table,
    User: prisma.user as unknown as Table,
    UserSettings: prisma.userSettings as unknown as Table,
  };

  const results: BackfillResult[] = [];
  for (const { label, fields } of CREDENTIAL_TABLES) {
    results.push(await backfillTable(tables[label], fields));
  }
  // The three token tables take the same treatment, so they are a list like
  // CREDENTIAL_TABLES above rather than three near-identical statements.
  const TOKEN_TABLES: [Table, string][] = [
    [prisma.shareLink as unknown as Table, "ShareLink"],
    [prisma.apiKey as unknown as Table, "ApiKey"],
    [prisma.invitation as unknown as Table, "Invitation"],
  ];
  for (const [table, label] of TOKEN_TABLES) {
    results.push(await backfillTokens(table, label));
  }

  return results.reduce(
    (acc, r) => ({
      encrypted: acc.encrypted + r.encrypted,
      alreadyDone: acc.alreadyDone + r.alreadyDone,
      failures: acc.failures + r.failures,
    }),
    { encrypted: 0, alreadyDone: 0, failures: 0 }
  );
}
