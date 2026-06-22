"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { Link, Search, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setGocardlessInstitutionId } from "@/lib/actions/institutions";

const COUNTRIES = [
  { code: "FR", label: "France" },
  { code: "DE", label: "Allemagne" },
  { code: "ES", label: "Espagne" },
  { code: "IT", label: "Italie" },
  { code: "BE", label: "Belgique" },
  { code: "NL", label: "Pays-Bas" },
  { code: "PT", label: "Portugal" },
  { code: "AT", label: "Autriche" },
  { code: "PL", label: "Pologne" },
  { code: "GB", label: "Royaume-Uni" },
  { code: "IE", label: "Irlande" },
  { code: "SE", label: "Suède" },
  { code: "DK", label: "Danemark" },
  { code: "FI", label: "Finlande" },
  { code: "NO", label: "Norvège" },
];

interface GCInstitution {
  id: string;
  name: string;
  logo: string;
}

interface Props {
  institutionId: string;
  institutionName: string;
}

export function ConnectOpenBankingDialog({ institutionId, institutionName }: Props) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState("FR");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GCInstitution[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ country });
      if (search.trim()) params.set("search", search.trim());
      fetch(`/api/gocardless/institutions?${params}`)
        .then((r) => r.json())
        .then((data) => setResults(Array.isArray(data) ? data : []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, country, search]);

  function handleSelect(gcId: string) {
    startTransition(async () => {
      await setGocardlessInstitutionId(institutionId, gcId);
      setOpen(false);
      window.location.href = `/api/gocardless/connect?institutionId=${institutionId}`;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { setOpen(v); if (!v) { setSearch(""); setResults([]); } }}
      title={`Connecter ${institutionName} via Open Banking`}
      trigger={
        <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-[44px] rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
          <Link size={12} />
          Connecter
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            value={country}
            onChange={(e) => { setCountry(e.target.value); setSearch(""); }}
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] shrink-0"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une banque…"
              autoFocus
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-[var(--muted)]">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              {search ? "Aucune banque trouvée" : "Chargement…"}
            </p>
          ) : (
            results.map((inst) => (
              <button
                key={inst.id}
                onClick={() => handleSelect(inst.id)}
                disabled={pending}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] transition-colors text-left disabled:opacity-50"
              >
                {inst.logo ? (
                  <img src={inst.logo} alt="" className="w-7 h-7 rounded object-contain bg-white" />
                ) : (
                  <div className="w-7 h-7 rounded bg-[var(--border)]" />
                )}
                <span className="text-sm text-[var(--foreground)]">{inst.name}</span>
              </button>
            ))
          )}
        </div>

        <p className="text-xs text-[var(--muted)]">
          Vous serez redirigé vers votre banque pour autoriser l&apos;accès.
        </p>
      </div>
    </Dialog>
  );
}
