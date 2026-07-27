"use server";

import { prisma } from "@/lib/prisma";

const SYNC_URL = process.env.SYNC_SERVICE_URL ?? "http://sync:8000";

// Explicit allowlist - prevents any user-controlled value from reaching the URL
const SYNC_PATHS = {
  "lcl": "/sync/lcl",
  "trade-republic": "/sync/trade-republic",
} as const;

// CUID format produced by Prisma @default(cuid())
const CUID_RE = /^c[a-z0-9]{20,30}$/;

export async function triggerSync(source: "lcl" | "trade-republic") {
  const path = SYNC_PATHS[source];
  const res = await fetch(`${SYNC_URL}${path}`, { method: "POST" });
  if (!res.ok) throw new Error(`Sync service error: ${res.status}`);
  return res.json();
}

export async function startLCLSetup(): Promise<{ status: "pending_approval" | "already_connected"; accounts?: number }> {
  const res = await fetch(`${SYNC_URL}/sync/lcl/setup/start`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function completeLCLSetup(): Promise<{ accounts: number }> {
  const res = await fetch(`${SYNC_URL}/sync/lcl/setup/complete`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function startTRSetup(): Promise<{ countdown: number }> {
  const res = await fetch(`${SYNC_URL}/sync/trade-republic/setup/start`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

export async function completeTRSetup(code: string): Promise<void> {
  const res = await fetch(`${SYNC_URL}/sync/trade-republic/setup/complete`, {
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
  const res = await fetch(`${SYNC_URL}/sync/institution/${institutionId}`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Sync service error: ${res.status}`);
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

  await fetch(`${SYNC_URL}/sync/all/async`, { method: "POST" }).catch(() => {});
  return { triggered: true };
}
