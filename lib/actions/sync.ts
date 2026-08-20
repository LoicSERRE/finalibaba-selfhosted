"use server";

import { prisma } from "@/lib/db/prisma";

// Internal Docker Compose service-to-service traffic on a private bridge
// network, never exposed externally - TLS here would need self-signed cert
// management between two containers for no real security benefit.
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const SYNC_URL = process.env.SYNC_SERVICE_URL ?? "http://sync:8000";

// Real production report: none of the fetch() calls below to the sync
// service ever had a timeout - a genuinely slow/hung bank sync (e.g. no
// internet reaching the bank from inside the sync container, or a Woob
// session stuck mid-negotiation) left the triggering button spinning
// forever with zero feedback, no way to know it had failed vs. was just
// slow. 2 minutes is generous enough for a real sync/2FA round-trip
// (these do genuinely scrape a real bank site, not just call a fast local
// API) while still bounding the worst case instead of hanging
// indefinitely. AbortSignal.timeout() is the built-in way to do this
// without manually wiring an AbortController per call.
const SYNC_TIMEOUT_MS = 2 * 60 * 1000;

async function fetchSync(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${SYNC_URL}${path}`, { ...init, signal: AbortSignal.timeout(SYNC_TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error("La synchronisation a pris trop de temps et a été interrompue - réessaie plus tard.");
    }
    throw e;
  }
}

// Explicit allowlist - prevents any user-controlled value from reaching the URL
const SYNC_PATHS = {
  "lcl": "/sync/lcl",
  "trade-republic": "/sync/trade-republic",
} as const;

// CUID format produced by Prisma @default(cuid())
const CUID_RE = /^c[a-z0-9]{20,30}$/;

export async function triggerSync(source: "lcl" | "trade-republic") {
  const path = SYNC_PATHS[source];
  const res = await fetchSync(path, { method: "POST" });
  if (!res.ok) throw new Error(`Sync service error: ${res.status}`);
  return res.json();
}

export async function startLCLSetup(): Promise<{ status: "pending_approval" | "already_connected"; accounts?: number }> {
  const res = await fetchSync("/sync/lcl/setup/start", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function completeLCLSetup(): Promise<{ accounts: number }> {
  const res = await fetchSync("/sync/lcl/setup/complete", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function startTRSetup(): Promise<{ countdown: number }> {
  const res = await fetchSync("/sync/trade-republic/setup/start", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function completeTRSetup(code: string): Promise<void> {
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

export async function getSyncStatus() {
  const logs = await prisma.syncLog.findMany({
    distinct: ["source"],
    orderBy: { createdAt: "desc" },
  });
  return Object.fromEntries(logs.map((l) => [l.source, l]));
}

export async function triggerInstitutionSync(institutionId: string) {
  if (!CUID_RE.test(institutionId)) throw new Error("Invalid institution ID");
  const res = await fetchSync(`/sync/institution/${institutionId}`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Sync service error: ${res.status}`);
  }
  return res.json();
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

export type WoobSetupResult =
  | { status: "already_connected"; accounts: number }
  | { status: "pending_approval"; medium_type: string | null; medium_label: string | null; message: string | null }
  | { status: "code_required"; medium_type: string | null; medium_label: string | null; message: string | null }
  | { status: "unsupported"; message: string };

export async function startInstitutionSetup(institutionId: string): Promise<WoobSetupResult> {
  if (!CUID_RE.test(institutionId)) throw new Error("Invalid institution ID");
  const res = await fetchSync(`/sync/institution/${institutionId}/setup/start`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function completeInstitutionSetup(institutionId: string, code?: string): Promise<{ accounts: number }> {
  if (!CUID_RE.test(institutionId)) throw new Error("Invalid institution ID");
  const res = await fetchSync(`/sync/institution/${institutionId}/setup/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code ?? null }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function autoTriggerSync(): Promise<{ triggered: boolean }> {
  const lastSync = await prisma.syncLog.findFirst({
    where: { status: "success" },
    orderBy: { createdAt: "desc" },
  });

  const STALE_MS = 10 * 60 * 1000;
  const isStale = !lastSync || Date.now() - lastSync.createdAt.getTime() > STALE_MS;
  if (!isStale) return { triggered: false };

  await fetchSync("/sync/all/async", { method: "POST" }).catch(() => {});
  return { triggered: true };
}
