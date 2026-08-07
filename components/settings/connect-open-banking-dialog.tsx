"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { Link, Search, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { setGocardlessInstitutionId } from "@/lib/actions/institutions";
import { useLocale, useTranslations } from "next-intl";

interface GCInstitution {
  id: string;
  name: string;
  logo: string;
}

interface Props {
  institutionId: string;
  institutionName: string;
}

const COUNTRY_CODES = ["FR", "DE", "ES", "IT", "BE", "NL", "PT", "AT", "PL", "GB", "IE", "SE", "DK", "FI", "NO"];

export function ConnectOpenBankingDialog({ institutionId, institutionName }: Readonly<Props>) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState("FR");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GCInstitution[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useTranslations("connectOpenBanking");
  const locale = useLocale();

  const countryNames = new Intl.DisplayNames([locale], { type: "region" });

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
      title={t("title", { name: institutionName })}
      trigger={
        <Button size="sm">
          <Link size={12} aria-hidden="true" />
          {t("connect")}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            aria-label={t("countryAriaLabel")}
            value={country}
            onChange={(e) => { setCountry(e.target.value); setSearch(""); }}
            className="bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 min-h-[44px] text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] shrink-0 cursor-pointer"
          >
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>{countryNames.of(code) ?? code}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
            <input
              type="text"
              aria-label={t("searchAriaLabel")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              autoFocus
              className="w-full bg-[var(--surface-elevated)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-2 min-h-[44px] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          {loading ? (
            <output className="flex items-center justify-center py-10 text-[var(--muted)]" aria-label={t("loading")}>
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            </output>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              {search ? t("noBank") : t("loading")}
            </p>
          ) : (
            results.map((inst) => (
              <button
                key={inst.id}
                type="button"
                onClick={() => handleSelect(inst.id)}
                disabled={pending}
                className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] hover:bg-[var(--surface-elevated)] transition-colors text-left disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
              >
                {inst.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={inst.logo} alt="" className="w-7 h-7 rounded object-contain bg-white" />
                ) : (
                  <div className="w-7 h-7 rounded bg-[var(--border)]" />
                )}
                <span className="text-sm text-[var(--foreground)]">{inst.name}</span>
              </button>
            ))
          )}
        </div>

        <p className="text-xs text-[var(--muted)]">{t("redirectHint")}</p>
      </div>
    </Dialog>
  );
}
