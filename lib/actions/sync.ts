"use server";

import { prisma } from "@/lib/db/prisma";
import { getViewer, assertOwned, OWNER_USER_ID } from "@/lib/auth-context";

// Internal Docker Compose service-to-service traffic on a private bridge
// network, never exposed externally - TLS here would need self-signed cert
// management between two containers for no real security benefit.
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const SYNC_URL = process.env.SYNC_SERVICE_URL ?? "http://sync:8000";

// Every call below needs a timeout: without one a hung bank sync leaves the
// button spinning forever with no way to tell "failed" from "slow". Two
// minutes is generous for a real scrape and 2FA round-trip while still
// bounding the worst case.
const SYNC_TIMEOUT_MS = 2 * 60 * 1000;

// Completing a setup can legitimately outlast the default: a bank that ends in
// a phone approval is polled by its Woob module until the user taps it, and
// Amundi's handler runs 60 attempts three seconds apart - 180s - before giving
// up. At the 2min default the browser abandoned first, so a validation that was
// still perfectly alive surfaced as a spinner that never resolved (issue #51).
// Sized above the module's own ceiling so the bank's answer, not our clock,
// decides the outcome.
const SETUP_COMPLETE_TIMEOUT_MS = 4 * 60 * 1000;
// An indicator is never worth making the page wait for.
const REALTIME_STATUS_TIMEOUT_MS = 2000;

/**
 * A failure worth showing the user, as opposed to a bug.
 *
 * Next replaces a THROWN Server Action error with an opaque digest in
 * production, so every message in this file reached the user in dev and
 * nothing at all once deployed. Expected errors are returned as values; this
 * type is the internal carrier.
 */
class SyncServiceError extends Error {}

function asFailure(e: unknown): { ok: false; error: string } {
  if (e instanceof SyncServiceError) return { ok: false, error: e.message };
  throw e; // a real bug, or an authorization failure - let it be a 500
}

// Generous by default because these calls drive a real bank scrape or a 2FA
// round-trip. Overridable because not all of them do: a status read runs on
// every Settings render, where the default would mean a hung sync service
// holding the whole page for two minutes.
async function fetchSync(path: string, init?: RequestInit, timeoutMs = SYNC_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(`${SYNC_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new SyncServiceError(
        "La synchronisation a pris trop de temps et a été interrompue - réessaie plus tard.",
      );
    }
    // The sync service being unreachable is an everyday state (it is optional,
    // and not started at all in local dev), so it is a message rather than a
    // stack trace - but never the raw one, which can carry a hostname.
    throw new SyncServiceError("Service de synchronisation injoignable - vérifie qu'il tourne.");
  }
}

// Explicit allowlist - prevents any user-controlled value from reaching the URL
const SYNC_PATHS = {
  "lcl": "/sync/lcl",
  "trade-republic": "/sync/trade-republic",
} as const;

// CUID format produced by Prisma @default(cuid())
const CUID_RE = /^c[a-z0-9]{20,30}$/;

// .env credentials are deploy-time config, so the env-configured syncs belong
// to the owner and only the owner can drive them. About the CREDENTIALS, not
// the data: their accounts stay co-ownable and grant-viewable.
async function assertOwnsEnvSync(): Promise<void> {
  const viewer = await getViewer();
  if (viewer.id !== OWNER_USER_ID) {
    throw new Error("Seul le propriétaire de l'instance peut gérer les synchronisations configurées via .env.");
  }
}

// Woob institutions are per-user rows, so driving one is gated on owning it
// rather than on being the instance owner.
async function assertOwnsInstitution(institutionId: string): Promise<void> {
  if (!CUID_RE.test(institutionId)) throw new Error("Invalid institution ID");
  const viewer = await getViewer();
  await assertOwned("institution", institutionId, viewer.id);
}

export async function triggerSync(source: "lcl" | "trade-republic") {
  await assertOwnsEnvSync();
  const path = SYNC_PATHS[source];
  const res = await fetchSync(path, { method: "POST" });
  if (!res.ok) throw new Error(`Sync service error: ${res.status}`);
  return res.json();
}

export async function startLCLSetup(): Promise<{ status: "pending_approval" | "already_connected"; accounts?: number }> {
  await assertOwnsEnvSync();
  const res = await fetchSync("/sync/lcl/setup/start", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function completeLCLSetup(): Promise<{ accounts: number }> {
  await assertOwnsEnvSync();
  const res = await fetchSync("/sync/lcl/setup/complete", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function startTRSetup(): Promise<{ countdown: number }> {
  await assertOwnsEnvSync();
  const res = await fetchSync("/sync/trade-republic/setup/start", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function completeTRSetup(code: string): Promise<void> {
  await assertOwnsEnvSync();
  const res = await fetchSync("/sync/trade-republic/setup/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
}

// SyncLog.userId carries a permanent DB-level default of the owner (see
// schema.prisma) because sync/db.py writes this table via raw SQL that knows
// nothing about the column - so env-synced LCL/TR rows land on the owner,
// exactly D3's semantics, while a Woob institution's rows are attributed to
// whoever configured it. Filtering by the viewer means a member's Settings
// page shows their own institutions' sync state and not the owner's.
export async function getSyncStatus() {
  const viewer = await getViewer();
  const logs = await prisma.syncLog.findMany({
    where: { userId: viewer.id },
    distinct: ["source"],
    orderBy: { createdAt: "desc" },
  });
  return Object.fromEntries(logs.map((l) => [l.source, l]));
}

/**
 * Which connections hold a live real-time websocket. "listening" is the only
 * state where a portfolio updates by itself, and a portfolio sitting still
 * otherwise looks identical whether real-time is working, off, or reconnecting.
 *
 * No ownership check: it reports PROCESS state, names no account or balance,
 * and every id in it came from the caller. Degrades to null rather than
 * throwing - the sync service is optional and absent in local dev.
 */
export type RealtimeStatus = {
  enabled: boolean;
  env: string;
  institutions: Record<string, string>;
};

export async function getRealtimeStatus(): Promise<RealtimeStatus | null> {
  try {
    const res = await fetchSync("/realtime/status", undefined, REALTIME_STATUS_TIMEOUT_MS);
    if (!res.ok) return null;
    return (await res.json()) as RealtimeStatus;
  } catch {
    return null;
  }
}

export type SyncOutcome = { ok: true } | { ok: false; error: string };

export async function triggerInstitutionSync(institutionId: string): Promise<SyncOutcome> {
  // Authorization still throws: someone driving another user's institution is
  // not an expected error, and must not get a readable explanation.
  await assertOwnsInstitution(institutionId);
  try {
    const res = await fetchSync(`/sync/institution/${institutionId}`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new SyncServiceError((data as { error?: string }).error ?? `Erreur ${res.status}`);
    }
    await res.json().catch(() => ({}));
    return { ok: true };
  } catch (e) {
    return asFailure(e);
  }
}

export type WoobBankModule = { module: string; label: string };

// Small fixed fallback for when the sync service can't be reached (e.g.
// local dev, where only the DB runs - see CLAUDE.md) - the same handful of
// major French banks this dropdown originally hardcoded, so "Configurer
// Woob" still works somewhere sync isn't up, just without the full ~96-bank
// catalog GET /woob/modules returns when it is.
const WOOB_MODULES_FALLBACK: WoobBankModule[] = [
  { module: "lcl", label: "LCL" },
  { module: "bnporc", label: "BNP Paribas" },
  { module: "caissedepargne", label: "Caisse d'Épargne" },
  { module: "societegenerale", label: "Société Générale" },
  { module: "creditagricole", label: "Crédit Agricole" },
  { module: "boursorama", label: "Boursorama" },
  { module: "fortuneo", label: "Fortuneo" },
  { module: "hellobank", label: "Hello Bank!" },
  { module: "ing", label: "ING France" },
  { module: "bforbank", label: "BforBank" },
  { module: "monabanq", label: "Monabanq" },
  { module: "hsbc", label: "HSBC France" },
  { module: "banquepostale", label: "La Banque Postale" },
  { module: "cic", label: "CIC" },
  { module: "creditdunord", label: "Crédit du Nord" },
  { module: "linxea", label: "Linxea" },
  { module: "degiro", label: "DEGIRO" },
];

export async function getWoobBankModules(): Promise<WoobBankModule[]> {
  try {
    const res = await fetch(`${SYNC_URL}/woob/modules`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    if (!res.ok) return WOOB_MODULES_FALLBACK;
    const data = (await res.json()) as { modules: WoobBankModule[] };
    return data.modules.length > 0 ? data.modules : WOOB_MODULES_FALLBACK;
  } catch {
    return WOOB_MODULES_FALLBACK;
  }
}

// Shared by both setup backends, which is why it is named for the route rather
// than for Woob. The optional fields are what differs: Woob reports the medium
// it used, Trade Republic how long its pushed code stays valid.
export type InstitutionSetupResult =
  /** `synced` is how many accounts the setup itself WROTE, using the session
   *  the user just authorised. Present means the data is already in the
   *  database and no follow-up sync is needed - for an MFA bank a follow-up
   *  would fail and overwrite this success with a false error. */
  | { status: "already_connected"; accounts?: number; synced?: number }
  /** `medium_type` is optional because the Woob payload simply does not carry
   *  it for an approval (see setup_woob.py's AppValidation branch, which sends
   *  only medium_label and message) - it was declared required and was always
   *  undefined at runtime. */
  | { status: "pending_approval"; medium_type?: string | null; medium_label?: string | null; message?: string | null }
  | {
      status: "code_required";
      medium_type?: string | null;
      medium_label?: string | null;
      message?: string | null;
      /** Trade Republic only: seconds its pushed code stays valid. */
      countdown?: number;
    }
  /** The bank put a reCAPTCHA in front of its login (Amundi does). Woob raises
   *  this only because nothing supplied an answer - the widget renders, a human
   *  solves it, and the token comes back through the SAME `code` parameter an
   *  SMS code uses. `website_key` is null only if a future Woob version stops
   *  carrying it, which the UI treats as unsupported rather than guessing. */
  | {
      status: "captcha_required";
      website_key: string | null;
      website_url: string | null;
      /** v2 is a checkbox a human ticks; v3 is invisible and scored from
       *  behaviour, with nothing to click. Different scripts, different calls -
       *  rendering one for the other gets "Invalid input" from Google. */
      captcha_kind?: "v2" | "v3";
      captcha_action?: string | null;
      captcha_enterprise?: boolean;
      message: string | null;
    }
  | { status: "unsupported"; message: string }
  /** The sync service refused or could not be reached. Carried as a value so
   *  the reason survives production's redaction of thrown errors. */
  | { status: "failed"; ok: false; error: string };

export async function startInstitutionSetup(institutionId: string): Promise<InstitutionSetupResult> {
  await assertOwnsInstitution(institutionId);
  try {
    const res = await fetchSync(`/sync/institution/${institutionId}/setup/start`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new SyncServiceError((data as { error?: string }).error ?? `Erreur ${res.status}`);
    }
    return res.json();
  } catch (e) {
    return { status: "failed", ...asFailure(e) };
  }
}

/** Woob reports how many accounts it found; Trade Republic just reports that
 *  the session is now established, so both fields are optional. */
export type InstitutionSetupCompletion =
  | { ok: true; accounts?: number; status?: "connected"; synced?: number }
  /** The bank answered a completed step with ANOTHER step instead of a
   *  session: Amundi follows a solved captcha with a phone approval. The Woob
   *  session stays alive on the sync side, so this is a state to resume and
   *  never a failure - the caller routes it back through the same panel logic
   *  the start path uses. Shapes match InstitutionSetupResult's own members so
   *  it can be handed straight to it. */
  | {
      ok: true;
      status: "pending_approval" | "code_required";
      medium_type?: string | null;
      medium_label?: string | null;
      message?: string | null;
    }
  | { ok: false; error: string };

export async function completeInstitutionSetup(
  institutionId: string,
  code?: string,
): Promise<InstitutionSetupCompletion> {
  await assertOwnsInstitution(institutionId);
  try {
    const res = await fetchSync(
      `/sync/institution/${institutionId}/setup/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code ?? null }),
      },
      SETUP_COMPLETE_TIMEOUT_MS,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new SyncServiceError((data as { error?: string }).error ?? `Erreur ${res.status}`);
    }
    return { ok: true, ...(await res.json().catch(() => ({}))) };
  } catch (e) {
    return asFailure(e);
  }
}

// Fired by <AutoSync /> on page load, scoped to the viewer's OWN sources: an
// instance-wide sync would have a member's page load re-scrape the owner's
// banks, and the staleness check would read the owner's last success.
//
// The owner keeps the instance-wide call, the only path that can drive the
// .env integrations. A member triggers their own institutions one by one -
// the sync service has no notion of users, so "mine" has to be an explicit
// list of ids.
export async function autoTriggerSync(): Promise<{ triggered: boolean }> {
  const viewer = await getViewer();
  const lastSync = await prisma.syncLog.findFirst({
    where: { userId: viewer.id, status: "success" },
    orderBy: { createdAt: "desc" },
  });

  const STALE_MS = 10 * 60 * 1000;
  const isStale = !lastSync || Date.now() - lastSync.createdAt.getTime() > STALE_MS;
  if (!isStale) return { triggered: false };

  if (viewer.id === OWNER_USER_ID) {
    await fetchSync("/sync/all/async", { method: "POST" }).catch(() => {});
    return { triggered: true };
  }

  const institutions = await prisma.institution.findMany({
    where: { userId: viewer.id, woobModule: { not: null }, woobLogin: { not: null } },
    select: { id: true },
  });
  if (institutions.length === 0) return { triggered: false };

  await Promise.all(
    institutions.map((i) => fetchSync(`/sync/institution/${i.id}`, { method: "POST" }).catch(() => {}))
  );
  return { triggered: true };
}
