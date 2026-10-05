import { NextRequest, NextResponse } from "next/server";
import { AUDIT, recordAuditEvent } from "@/lib/services/audit-log";
import { decryptBackup, isEncryptedBackup } from "@/lib/domain/backup-encryption";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { buildConnectionString, refuseBackupRequest } from "@/lib/services/database-backup";

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

// Restore only. Downloading moved to POST /api/backup/download, so that the
// passphrase travels in a request body rather than in a URL that ends up in
// browser history and proxy logs. With no GET here, no URL can carry it.
export async function POST(req: NextRequest) {
  const refused = await refuseBackupRequest(req);
  if (refused) return refused;

  // A restore replaces the entire instance, the User table included, so it
  // can install arbitrary credentials. Recorded first - the row is written to
  // the database this is about to overwrite, so it survives only if the
  // restore fails, which is the case worth being able to see.
  await recordAuditEvent({ action: AUDIT.backupRestored });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.error("Failed to parse restore upload:", err);
    return NextResponse.json({ error: "No backup file provided." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "No backup file provided." }, { status: 400 });
  }

  let buffer = Buffer.from(await file.arrayBuffer());
  // Accept both gzip-compressed (backup.sh, the download button) and plain .sql uploads.
  // Decrypt before anything looks for gzip: an encrypted backup is opaque,
  // and the gzip check below would otherwise reject it as "not a valid
  // backup" with no hint that a passphrase was the missing piece.
  if (isEncryptedBackup(buffer)) {
    const passphrase = (formData.get("passphrase") as string) || "";
    if (!passphrase) {
      return NextResponse.json(
        { error: "This backup is encrypted. Enter the passphrase it was created with." },
        { status: 400 }
      );
    }
    const decrypted = decryptBackup(buffer, passphrase);
    // One message for a wrong passphrase and for a damaged file, deliberately:
    // telling them apart tells whoever is holding a stolen backup which of the
    // two they are up against.
    if (!decrypted) {
      return NextResponse.json(
        { error: "Could not decrypt this backup. Check the passphrase, or the file may be damaged." },
        { status: 400 }
      );
    }
    buffer = decrypted;
  }

  if (buffer.subarray(0, 2).equals(GZIP_MAGIC)) {
    try {
      buffer = gunzipSync(buffer);
    } catch (err) {
      console.error("Failed to decompress uploaded backup:", err);
      return NextResponse.json({ error: "The uploaded file is not a valid gzip backup." }, { status: 400 });
    }
  }

  const { connStr, password } = buildConnectionString(process.env.DATABASE_URL!);

  try {
    await new Promise<void>((resolve, reject) => {
      // Same PATH-resolution tradeoff as the pg_dump call above.
      const psql = spawn(
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        "psql",
        [connStr, "-v", "ON_ERROR_STOP=1", "--single-transaction"],
        { env: { ...process.env, PGPASSWORD: password } }
      );

      let stderr = "";
      psql.stderr.on("data", (chunk) => (stderr += chunk));
      psql.on("error", reject);
      psql.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `psql exited with code ${code}`));
      });

      psql.stdin.write(buffer);
      psql.stdin.end();
    });
  } catch (err) {
    // Full detail stays server-side only - never echo raw exception output to the client.
    console.error("Restore failed:", err);
    return NextResponse.json({ error: "Restore failed. Check server logs for details." }, { status: 500 });
  }

  // The restore just dropped and recreated the whole schema out from under
  // this process's own Prisma connection pool - any pooled connection can now
  // hold a query plan referencing pre-restore table/type OIDs. Exit and let
  // the container's `restart: unless-stopped` policy bring the app back up
  // with a fresh pool, the same safety net scripts/restore.sh gets by
  // stopping the app container before restoring. Give the response time to
  // flush to the client first.
  if (process.env.NODE_ENV === "production") {
    setTimeout(() => process.exit(0), 1000);
  }

  return NextResponse.json({ ok: true });
}
