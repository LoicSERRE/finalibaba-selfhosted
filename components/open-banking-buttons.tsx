"use client";

import { useTransition } from "react";
import { RefreshCw, Link } from "lucide-react";
import { syncGocardlessBalances } from "@/lib/actions/gocardless";

export function ConnectOpenBankingButton({ institutionId }: { institutionId: string }) {
  return (
    <a
      href={`/api/gocardless/connect?institutionId=${institutionId}`}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-[44px] rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
    >
      <Link size={12} aria-hidden="true" />
      Connecter
    </a>
  );
}

export function SyncOpenBankingButton({ institutionId }: { institutionId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => syncGocardlessBalances(institutionId))}
      disabled={pending}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-[44px] rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} aria-hidden="true" />
      {pending ? "Sync…" : "Synchroniser"}
    </button>
  );
}
