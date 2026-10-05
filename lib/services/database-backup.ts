import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { createBackupCipher } from "@/lib/domain/backup-encryption";
import { isAllowedOrigin } from "@/lib/domain/request-origin";
import { requireAdmin } from "@/lib/auth-context";

/**
 * The gate every whole-database request passes, download and restore alike.
 * Returns the refusal to send, or null to proceed.
 *
 * Origin first, before the admin check: on a default instance (AUTH_ENABLED
 * off) the admin check alone admits any page on any site that can reach this
 * address, since there is no cookie to withhold. See
 * lib/domain/request-origin.ts.
 *
 * Then admin: both operations cover every user's data, by design (this wraps
 * pg_dump/psql, not a per-user export), which makes them a full-instance
 * takeover primitive in multi-user - a download reads everyone's finances, a
 * restore replaces the whole instance including the user table. In mono mode
 * the viewer is the owner, who is ADMIN, so that part never fires.
 */
export async function refuseBackupRequest(req: NextRequest): Promise<NextResponse | null> {
  const sameOrigin = isAllowedOrigin({
    origin: req.headers.get("origin"),
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    appUrl: process.env.APP_URL,
  });
  if (!sameOrigin) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }
  try {
    await requireAdmin();
    return null;
  } catch {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
}

// Strip the password out of the connection string (so it never appears in
// `ps` output for the spawned pg_dump/psql) but keep every other part -
// including query params like ?sslmode=require - intact. libpq falls back to
// PGPASSWORD when the URI has a username but no password.
export function buildConnectionString(databaseUrl: string): { connStr: string; password: string } {
  const u = new URL(databaseUrl);
  const password = decodeURIComponent(u.password);
  u.password = "";
  return { connStr: u.toString(), password };
}

/**
 * Streams a passphrase-encrypted, gzipped pg_dump of the WHOLE database.
 *
 * The caller has already checked the origin, the admin role and that the
 * passphrase is non-empty - pg_dump is only spawned once all three hold. It
 * used to start before the passphrase check, so a request without one got its
 * 400 while a full dump kept running into a pipe nobody read.
 *
 * Passphrase encryption of the FILE, now REQUIRED rather than opt-in.
 *
 * This dump is the whole database: every user's accounts, balances and
 * transaction labels, in clear. It was optional while the instance had one
 * user, where the only record in the file was the downloader's own. On a
 * multi-user instance the admin is carrying other people's finances into a
 * Downloads folder, and "I forgot to tick the box" is not a decision anybody
 * makes deliberately. Per-user exports (/api/my-data) need no passphrase,
 * because there the file holds only its owner's data.
 *
 * Still the user's own passphrase and not the instance key: a backup exists
 * to survive a disaster, and disasters take .env with them.
 */
export function encryptedDumpResponse(passphrase: string): NextResponse {
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

  const gzip = createGzip();
  dump.stdout.pipe(gzip);
  const encryption = createBackupCipher(passphrase);
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
