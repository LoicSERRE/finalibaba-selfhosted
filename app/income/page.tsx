export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { Coins } from "lucide-react";
import { AddIncomeDialog } from "@/components/add-income-dialog";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { deleteIncomeEvent } from "@/lib/actions/income";
import { formatCurrency, centsToEuro } from "@/lib/format";
import { getTranslations } from "next-intl/server";

const INCOME_ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "INVESTMENT", "CRYPTO"] as const;

export default async function IncomePage() {
  const [t, tc] = await Promise.all([getTranslations("income"), getTranslations("common")]);

  const [events, accounts] = await Promise.all([
    prisma.incomeEvent.findMany({
      include: { account: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.account.findMany({
      where: { type: { in: [...INCOME_ACCOUNT_TYPES] } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const startOfNextYear = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  const ytdEvents = events.filter((e) => e.date >= startOfYear && e.date < startOfNextYear);

  const netCents = (e: (typeof events)[number]) => e.amountCents - (e.taxWithheldCents ?? BigInt(0));

  const ytdDividendsNetCents = ytdEvents
    .filter((e) => e.type === "DIVIDEND")
    .reduce((sum, e) => sum + netCents(e), BigInt(0));
  const ytdInterestNetCents = ytdEvents
    .filter((e) => e.type === "INTEREST")
    .reduce((sum, e) => sum + netCents(e), BigInt(0));
  const ytdTotalNetCents = ytdDividendsNetCents + ytdInterestNetCents;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
        </div>
        {events.length > 0 && <AddIncomeDialog accounts={accounts} />}
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={Coins}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<AddIncomeDialog accounts={accounts} />}
        />
      ) : (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">{t("ytdTitle")}</p>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("ytdDividends")}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">{formatCurrency(ytdDividendsNetCents, 0)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("ytdInterest")}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">{formatCurrency(ytdInterestNetCents, 0)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] mb-1">{t("ytdTotal")}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--positive)]">{formatCurrency(ytdTotalNetCents, 0)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {events.map((e) => (
              <div key={e.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-elevated)] text-[var(--muted)] shrink-0">
                      {e.type === "DIVIDEND" ? t("dividend") : t("interest")}
                    </span>
                    <span className="text-sm font-medium truncate text-[var(--foreground)]">
                      {e.ticker ? `${e.ticker} · ${e.account.name}` : e.account.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AddIncomeDialog
                      initial={{
                        id: e.id,
                        type: e.type,
                        accountId: e.accountId,
                        ticker: e.ticker,
                        amountEuro: centsToEuro(e.amountCents),
                        taxWithheldEuro: e.taxWithheldCents != null ? centsToEuro(e.taxWithheldCents) : null,
                        date: e.date.toISOString().slice(0, 10),
                      }}
                      accounts={accounts}
                    />
                    <DeleteButton label={tc("delete")} description={tc("irreversible")} onDelete={deleteIncomeEvent.bind(null, e.id)} />
                  </div>
                </div>
                <p className="text-sm tabular-nums font-medium">
                  <span className="text-[var(--positive)]">{formatCurrency(netCents(e))}</span>
                  <span className="text-[var(--muted)] font-normal">
                    {" "}
                    · {new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(e.date)}
                    {e.taxWithheldCents != null && e.taxWithheldCents > BigInt(0) && (
                      <> · {t("grossOfTax", { gross: formatCurrency(e.amountCents), tax: formatCurrency(e.taxWithheldCents) })}</>
                    )}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
