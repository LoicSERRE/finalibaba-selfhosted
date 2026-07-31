import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { InstitutionLogo } from "@/components/institution-logo";
import { Sparkline } from "@/components/sparkline";
import type { FiatAccountRow } from "@/lib/accounts-page";
import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations>>;

export function FiatTab({ t, ta, rows }: { t: T; ta: T; rows: FiatAccountRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center text-sm text-[var(--muted)]">
        {t("noAccount")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((account) => (
        <Link
          key={account.id}
          href={`/accounts/${account.id}`}
          className="block bg-[var(--surface)] border border-[var(--border)] rounded-xl px-6 py-4 hover:border-[var(--accent)]/40 hover:bg-[var(--surface-elevated)] active:scale-[0.98] active:opacity-90 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                {account.institutionName && (
                  <InstitutionLogo name={account.institutionName} logoUrl={account.institutionLogoUrl} size={24} />
                )}
                <p className="text-xs text-[var(--muted)]">
                  {account.institutionName && `${account.institutionName} · `}
                  {ta(account.type as Parameters<typeof ta>[0])}
                </p>
              </div>
              <p className="font-medium text-[var(--foreground)] truncate">{account.name}</p>
            </div>
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {account.sparkValues.length >= 2 && (
                <span className="hidden sm:block">
                  <Sparkline values={account.sparkValues} />
                </span>
              )}
              <div className="text-right min-w-[110px]">
                <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
                  {formatCurrency(account.currentCents)}
                </p>
                {account.deltaCents !== BigInt(0) && (
                  <p
                    className={`text-xs tabular-nums ${
                      account.deltaCents > BigInt(0) ? "text-[var(--positive)]" : "text-[var(--negative)]"
                    }`}
                  >
                    {account.deltaCents > BigInt(0) ? "+" : ""}
                    {formatCurrency(account.deltaCents)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
