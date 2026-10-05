import { NextRequest, NextResponse } from "next/server";
import { AUDIT, recordAuditEvent } from "@/lib/services/audit-log";
import { encryptedDumpResponse, refuseBackupRequest } from "@/lib/services/database-backup";

/**
 * Whole-database download, as a POST so the passphrase is in the body.
 *
 * It used to be `GET /api/backup?passphrase=...`: a secret in a URL is written
 * into browser history and into every reverse-proxy access log on the way.
 * The settings page submits a plain HTML form here, so the browser still
 * handles Content-Disposition and streams the file to disk itself.
 *
 * Every check runs before pg_dump is spawned, and the audit row is written
 * only once the dump is actually going to happen.
 */
export async function POST(req: NextRequest) {
  const refused = await refuseBackupRequest(req);
  if (refused) return refused;

  let passphrase = "";
  try {
    const value = (await req.formData()).get("passphrase");
    passphrase = typeof value === "string" ? value : "";
  } catch {
    // Not a form body: treated exactly like an empty passphrase.
  }
  if (!passphrase) {
    return NextResponse.json(
      { error: "A passphrase is required: this file contains every user's data." },
      { status: 400 }
    );
  }

  // Recorded before the dump starts, not after: this streams the whole
  // database, every user included, and a download that fails halfway still
  // happened. The single most sensitive action the app offers.
  await recordAuditEvent({ action: AUDIT.backupDownloaded });

  return encryptedDumpResponse(passphrase);
}
