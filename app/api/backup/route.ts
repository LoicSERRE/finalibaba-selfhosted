import { NextRequest, NextResponse } from "next/server";
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

export async function GET() {
  const { connStr, password } = buildConnectionString(process.env.DATABASE_URL!);

  const dump = spawn("pg_dump", ["--clean", "--if-exists", "--no-owner", connStr], {
    env: { ...process.env, PGPASSWORD: password },
  });

  let stderr = "";
  dump.stderr.on("data", (chunk) => (stderr += chunk));

  const gzip = createGzip();
  dump.stdout.pipe(gzip);

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

      gzip.on("data", (chunk) => {
        if (settled) return;
        controller.enqueue(chunk);
      });
      gzip.on("end", () => {
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
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="finalibaba-backup-${timestamp}.sql.gz"`,
    },
  });
}

export async function POST(req: NextRequest) {
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
      const psql = spawn(
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
