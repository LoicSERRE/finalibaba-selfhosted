import { NextRequest, NextResponse } from "next/server";
import { AUDIT, recordAuditEvent } from "@/lib/services/audit-log";
import { createBackupCipher, decryptBackup, isEncryptedBackup } from "@/lib/domain/backup-encryption";
import { requireAdmin } from "@/lib/auth-context";
import { spawn } from "node:child_process";
import { createGzip, gunzipSync } from "node:zlib";

// Strip the password out of the connection string (so it never appears in
// `ps` output for the spawned pg_dump/psql) but keep every other part -
// including query params like ?sslmode=require - intact. libpq falls back to
// PGPASSWORD when the URI has a username but no password.
function buildConnectionString(databaseUrl: string): { connStr: string; password: string } {
  const u = new URL(databaseUrl);
  const password = decodeURIComponent(u.password);
  u.password = "";
  return { connStr: u.toString(), password };
}

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

// Both handlers operate on the WHOLE database - every user's data, by design
// (this wraps pg_dump/psql, not a per-user export). That makes it a
// full-instance takeover primitive in multi-user: a GET reads everyone's
// finances, a POST replaces the entire instance including the user table.
// Admin-only as of v2.0; before that the route had no auth of its own at all,
// relying entirely on proxy.ts's blanket session gate, which in multi-user
// any member passes. In mono mode the viewer is the owner, who is ADMIN, so
// this never fires.
async function assertBackupAllowed(): Promise<NextResponse | null> {
  try {
    await requireAdmin();
    return null;
  } catch {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
}

export async function GET(req: NextRequest) {
  const denied = await assertBackupAllowed();
  if (denied) return denied;

  // Recorded before the dump starts, not after: this streams the whole
  // database, every user included, and a download that fails halfway still
  // happened. The single most sensitive action the app offers.
  await recordAuditEvent({ action: AUDIT.backupDownloaded });

  const { connStr, password } = buildConnectionString(process.env.DATABASE_URL!);

  // sonarjs flags resolving pg_dump via PATH rather than an absolute path.
  // In production PATH is fixed by the Dockerfile (apk-installed
  // postgresql16-client, not attacker-influenced without prior code
  // execution in the container already); hardcoding an absolute path would
  // instead break `pnpm dev` on every OS/package-manager combo where
  // pg_dump isn't symlinked to the same location.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const dump = spawn("pg_dump", ["--clean", "--if-exists", "--no-owner", connStr], {
    env: { ...process.env, PGPASSWORD: password },
  });

  let stderr = "";
  dump.stderr.on("data", (chunk) => (stderr += chunk));

  // Passphrase encryption of the FILE, now REQUIRED rather than opt-in.
  //
  // This dump is the whole database: every user's accounts, balances and
  // transaction labels, in clear. It was optional while the instance had one
  // user, where the only record in the file was the downloader's own. On a
  // multi-user instance the admin is carrying other people's finances into a
  // Downloads folder, and "I forgot to tick the box" is not a decision anybody
  // makes deliberately. Per-user exports (/api/my-data) need no passphrase,
  // because there the file holds only its owner's data.
  //
  // Still the user's own passphrase and not the instance key: a backup exists
  // to survive a disaster, and disasters take .env with them.
  const passphrase = req.nextUrl.searchParams.get("passphrase") ?? "";
  if (!passphrase) {
    return NextResponse.json(
      { error: "A passphrase is required: this file contains every user's data." },
      { status: 400 }
    );
  }
  const gzip = createGzip();
  dump.stdout.pipe(gzip);
  const encryption = passphrase ? createBackupCipher(passphrase) : null;
  // gzip FIRST, then encrypt: compressing ciphertext achieves nothing, and
  // this way the compression ratio leaks no more than the file size already
  // does.
  const outbound = encryption ? gzip.pipe(encryption.cipher) : gzip;

  // Two independent completion signals race here: gzip's "end" (all bytes
  // flushed) and pg_dump's "close" (exit code known). If we settled the
  // stream as soon as gzip finished, a pg_dump that wrote a valid-looking
  // partial dump before dying mid-run would look like a *successful*
  // download - the corruption would only surface later, during an actual
  // restore. Wait for both, and only close() if the exit code was 0;
  // otherwise error() so the download visibly fails.
  let gzipEnded = false;
  let dumpExitCode: number | null = null;
  let settled = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function finish() {
        if (settled || !gzipEnded || dumpExitCode === null) return;
        settled = true;
        if (dumpExitCode === 0) {
          controller.close();
        } else {
          console.error(`pg_dump exited with code ${dumpExitCode}: ${stderr}`);
          controller.error(new Error(`pg_dump exited with code ${dumpExitCode}`));
        }
      }

      // The header goes out first, so a partial download is still
      // recognisable as one of ours rather than as corrupt gzip.
      if (encryption) controller.enqueue(encryption.header);

      outbound.on("data", (chunk) => {
        if (settled) return;
        controller.enqueue(chunk);
      });
      outbound.on("end", () => {
        // The GCM tag exists only once the cipher has finished, and it goes
        // at the end: without it the file cannot be authenticated, and
        // decryptBackup refuses anything it cannot authenticate.
        if (encryption && !settled) controller.enqueue(encryption.cipher.getAuthTag());
        gzipEnded = true;
        finish();
      });
      dump.on("error", (err) => {
        if (settled) return;
        settled = true;
        console.error("pg_dump failed to start:", err);
        controller.error(err);
      });
      dump.on("close", (code) => {
        dumpExitCode = code ?? 1;
        finish();
      });
    },
    cancel() {
      settled = true;
      dump.kill();
    },
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // The extension is how somebody finds it again months later and knows
  // they will be asked for a passphrase.
  const extension = encryption ? "sql.gz.enc" : "sql.gz";
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="finalibaba-backup-${timestamp}.${extension}"`,
    },
  });
}

export async function POST(req: NextRequest) {
  const denied = await assertBackupAllowed();
  if (denied) return denied;

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
