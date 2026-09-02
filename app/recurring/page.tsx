export const dynamic = "force-dynamic";

import { prisma } from "@/lib/db/prisma";
import { getViewer, viewAccountIds } from "@/lib/auth-context";
import { Repeat, AlertTriangle, Bot } from "lucide-react";
import { AddRecurringDialog } from "@/components/recurring/add-recurring-dialog";
import { SuggestionCard } from "@/components/recurring/suggestion-card";
import { CollapsibleSection } from "@/components/recurring/collapsible-section";
import { RestoreRecurringButton } from "@/components/recurring/restore-recurring-button";
import { ToggleRecurringButton } from "@/components/recurring/toggle-recurring-button";
import { DeleteButton } from "@/components/shared/delete-button";
import { EmptyState } from "@/components/shared/empty-state";
import { CashflowChart } from "@/components/recurring/cashflow-chart";
import { deleteRecurringTransaction, forgetRecurringTransaction } from "@/lib/actions/recurring";
import { formatCurrency, centsToEuro, localeToIntl } from "@/lib/utils/format";
import {
  detectCandidates,
  formatFrequencyLabel,
  getOccurrencesInRange,
  isMissed,
  normalizeLabel,
  projectDailyCumulative,
} from "@/lib/domain/recurring";
import { getTranslations, getLocale } from "next-intl/server";

const FIAT_TYPES = ["CHECKING", "SAVINGS", "MEAL_VOUCHER"] as const;
const HORIZON_DAYS = 90;
// Yearly patterns need ~2 years of history before 3 occurrences exist -
// widen the fetch window well past 12 months so yearly detection can fire.
const DETECTION_WINDOW_MONTHS = 25;

export default async function RecurringPage() {
  const [t, tc, locale] = await Promise.all([getTranslations("recurring"), getTranslations("common"), getLocale()]);
  const intlLocale = localeToIntl(locale);

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const detectionCutoff = new Date(now);
  detectionCutoff.setUTCMonth(detectionCutoff.getUTCMonth() - DETECTION_WINDOW_MONTHS);

  const viewer = await getViewer();
  const accountIds = await viewAccountIds(viewer.id);

  const [recurring, categories, accounts, recentTransactions] = await Promise.all([
    prisma.recurringTransaction.findMany({
      where: { accountId: { in: accountIds } },
      include: { category: true, account: { select: { name: true } } },
      orderBy: { label: "asc" },
    }),
    prisma.category.findMany({ where: { userId: viewer.id }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    prisma.account.findMany({
      where: { id: { in: accountIds }, type: { in: [...FIAT_TYPES] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.transaction.findMany({
      // Detection groups by (accountId, label), so feeding it only the
      // viewer's own accounts also keeps suggestions from being derived
      // across users who happen to share a merchant name.
      where: { accountId: { in: accountIds }, date: { gte: detectionCutoff } },
      select: { accountId: true, label: true, amountCents: true, date: true, categoryId: true },
    }),
  ]);

  // Live templates suppress a pattern outright. Dismissals are passed
  // separately with their evidence, because a dismissal expires: it holds
  // until the pattern stops and comes back, not forever. See
  // hasResumedAfterDismissal - "I cancelled this" should not silence a real
  // charge you resubscribe to next year.
  const key = (r: { accountId: string; label: string }) => `${r.accountId}|${normalizeLabel(r.label)}`;
  const existingKeys = new Set(recurring.filter((r) => r.dismissedAt === null).map(key));
  const dismissedPatterns = recurring
    .filter((r) => r.dismissedAt !== null)
    .map((r) => ({
      key: key(r),
      anchorDate: r.anchorDate,
      frequency: r.frequency,
      intervalCount: r.intervalCount,
    }));
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const candidates = detectCandidates(recentTransactions, existingKeys, dismissedPatterns).map((c) => ({
    ...c,
    accountName: accountNameById.get(c.accountId) ?? "?",
    anchorDate: c.anchorDate.toISOString().slice(0, 10),
  }));

  // Three states, not two. A dismissal used to be indistinguishable from a
  // pause (both were just active:false), so saying "stop suggesting this"
  // pushed a row into the visible list wearing a "Paused" badge - dismissing
  // added clutter instead of removing it. dismissedAt separates them.
  const dismissed = recurring.filter((r) => r.dismissedAt !== null);
  const active = recurring.filter((r) => r.active && r.dismissedAt === null);
  const inactive = recurring.filter((r) => !r.active && r.dismissedAt === null);

  const missedById = new Map(
    active.map((r) => [
      r.id,
      isMissed(
        { accountId: r.accountId, label: r.label, amountCents: r.amountCents, frequency: r.frequency, intervalCount: r.intervalCount, anchorDate: r.anchorDate },
        recentTransactions,
        now
      ),
    ])
  );

  const upcoming = active
    .flatMap((r) =>
      getOccurrencesInRange(r, now, horizonEnd).map((date) => ({
        date,
        label: r.label,
        amountCents: r.amountCents,
        color: r.category?.color ?? null,
      }))
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const netTotalCents = upcoming.reduce((sum, o) => sum + Number(o.amountCents), 0);

  const chartData = projectDailyCumulative(active, now, horizonEnd).map((p) => ({
    date: new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(p.date),
    cumulative: p.cumulativeCents,
  }));

  const dialogAccounts = accounts;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("title")}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{t("subtitle")}</p>
        </div>
        {recurring.length > 0 && <AddRecurringDialog accounts={dialogAccounts} categories={categories} />}
      </div>

      {recurring.length === 0 && candidates.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<AddRecurringDialog accounts={dialogAccounts} categories={categories} />}
        />
      ) : (
        <>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("chartTitle")}</h2>
              <span className="text-sm font-medium tabular-nums">
                {t("netTotal")}:{" "}
                <span className={netTotalCents >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                  {formatCurrency(netTotalCents)}
                </span>
              </span>
            </div>
            <CashflowChart data={chartData} />
          </div>

          {recurring.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("activeTitle")}</h2>
              {[...active, ...inactive].map((r) => (
                <div key={r.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {r.category && (
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.category.color }} aria-hidden="true" />
                      )}
                      <span className={`text-sm font-medium break-words ${r.active ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
                        {r.label}
                      </span>
                      {r.autoDetected && (
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-elevated)] text-[var(--muted)] shrink-0">
                          <Bot size={10} aria-hidden="true" />
                          {t("autoDetectedBadge")}
                        </span>
                      )}
                      {!r.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-elevated)] text-[var(--muted)] shrink-0">
                          {t("pausedBadge")}
                        </span>
                      )}
                      {r.active && missedById.get(r.id) && (
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--negative)]/15 text-[var(--negative)] shrink-0">
                          <AlertTriangle size={10} aria-hidden="true" />
                          {t("missedBadge")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ToggleRecurringButton id={r.id} active={r.active} />
                      <AddRecurringDialog
                        initial={{
                          id: r.id,
                          label: r.label,
                          amountEuro: centsToEuro(r.amountCents < BigInt(0) ? -r.amountCents : r.amountCents),
                          type: r.amountCents >= BigInt(0) ? "income" : "expense",
                          frequency: r.frequency,
                          intervalCount: r.intervalCount,
                          anchorDate: r.anchorDate.toISOString().slice(0, 10),
                          categoryId: r.categoryId,
                          accountId: r.accountId,
                        }}
                        accounts={dialogAccounts}
                        categories={categories}
                      />
                      <DeleteButton iconOnly label={tc("delete")} description={t("deleteConfirm")} onDelete={deleteRecurringTransaction.bind(null, r.id)} />
                    </div>
                  </div>
                  <p className="text-sm tabular-nums font-medium">
                    <span className={Number(r.amountCents) >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                      {formatCurrency(r.amountCents)}
                    </span>
                    <span className="text-[var(--muted)] font-normal">
                      {" "}
                      · {r.account.name} · {formatFrequencyLabel(r.frequency, r.intervalCount, t)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* After the templates you manage, not before them. These used to be
              the first thing on the page, pushing the active list below the
              fold on any account with a few detected patterns - reported as
              exactly that. Collapsed by default, EXCEPT when there is nothing
              else here: on a fresh install they are the whole point of the
              page rather than a distraction from it. */}
          {candidates.length > 0 && (
            <CollapsibleSection
              title={t("suggestionsTitle")}
              count={candidates.length}
              defaultOpen={recurring.length === 0}
            >
              {candidates.map((c) => (
                <SuggestionCard key={`${c.accountId}|${c.label}`} candidate={c} accounts={dialogAccounts} categories={categories} />
              ))}
            </CollapsibleSection>
          )}

          {/* Dismissed patterns, out of the way but not gone: dismissing used
              to leave a row in the main list wearing a "Paused" badge, and
              deleting handed the pattern straight back as a suggestion. Both
              land here now, restorable. */}
          {dismissed.length > 0 && (
            <CollapsibleSection title={t("dismissedTitle")} count={dismissed.length}>
              <p className="text-xs text-[var(--muted)]">{t("dismissedDescription")}</p>
              {dismissed.map((r) => (
                <div
                  key={r.id}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--muted)] break-words">{r.label}</p>
                    <p className="text-xs text-[var(--muted)] opacity-70 tabular-nums">
                      {formatCurrency(r.amountCents)} · {r.account.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <RestoreRecurringButton id={r.id} />
                    <DeleteButton
                      iconOnly
                      label={tc("delete")}
                      description={t("forgetConfirm")}
                      onDelete={forgetRecurringTransaction.bind(null, r.id)}
                    />
                  </div>
                </div>
              ))}
            </CollapsibleSection>
          )}

          {upcoming.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)]">
                <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">{t("upcomingTitle")}</h2>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {upcoming.map((o) => (
                  <div key={`${o.date.toISOString()}-${o.label}`} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {o.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.color }} aria-hidden="true" />}
                      <span className="text-sm text-[var(--foreground)] break-words">{o.label}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-sm tabular-nums">
                      <span className="text-[var(--muted)]">{new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(o.date)}</span>
                      <span className={Number(o.amountCents) >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>
                        {formatCurrency(o.amountCents)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
