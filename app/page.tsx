export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";
import { NetWorthChart } from "@/components/net-worth-chart";
import { AssetAllocationChart, type AllocationSlice } from "@/components/asset-allocation-chart";
import { AutoSync } from "@/components/auto-sync";
import { InstitutionLogo } from "@/components/institution-logo";
import Link from "next/link";
import Decimal from "decimal.js";
import { calcCurrentCapital, hasLoanParams } from "@/lib/loan";
import { getInstitutionLogoUrl } from "@/lib/institutions";

const TAX_RATES: Record<string, number> = { PEA: 0.172, CTO: 0.314, CRYPTO: 0.30 };

async function getDashboardData() {
  const accounts = await prisma.account.findMany({
    include: {
      institution: true,
      holdings: true,
      history: {
        orderBy: { recordedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  });

  let grossAssets = BigInt(0);
  let totalLiabilities = BigInt(0);
  let totalLatentTax = BigInt(0);

  const allocation: Record<string, bigint> = {
    Liquidités: BigInt(0),
    Épargne: BigInt(0),
    Investissements: BigInt(0),
    Crypto: BigInt(0),
    Immobilier: BigInt(0),
    Automobile: BigInt(0),
  };

  const now = new Date();

  // Per-institution grouping
  const instMap = new Map<
    string,
    {
      name: string;
      logoUrl: string | null;
      total: bigint;
      accounts: Array<{ id: string; name: string; value: bigint; type: string }>;
    }
  >();

  for (const account of accounts) {
    let value = BigInt(0);

    if (account.type === "REAL_ESTATE" || account.type === "AUTOMOBILE") {
      value = account.manualValueCents ?? BigInt(0);
      const liability = account.liabilityCents ?? BigInt(0);
      totalLiabilities += liability;
      const equity = value - liability > BigInt(0) ? value - liability : BigInt(0);
      allocation[account.type === "AUTOMOBILE" ? "Automobile" : "Immobilier"] += equity;
      grossAssets += value;
    } else if (account.type === "INVESTMENT" || account.type === "CRYPTO") {
      let accountGain = BigInt(0);
      let hasBasis = false;
      value = account.holdings.reduce((sum, h) => {
        const mv = BigInt(
          new Decimal(h.quantity.toString())
            .mul(h.lastPriceCents.toString())
            .round()
            .toNumber()
        );
        if (h.costBasisCents != null) {
          hasBasis = true;
          accountGain += mv - h.costBasisCents;
        }
        return sum + mv;
      }, BigInt(0));
      // Latent tax on net gain
      if (hasBasis) {
        const taxRate =
          account.type === "CRYPTO"
            ? TAX_RATES.CRYPTO
            : account.investmentSubtype
            ? (TAX_RATES[account.investmentSubtype] ?? null)
            : null;
        if (taxRate !== null && accountGain > BigInt(0)) {
          totalLatentTax += BigInt(Math.round(Number(accountGain) * taxRate));
        }
      }
      allocation[account.type === "CRYPTO" ? "Crypto" : "Investissements"] += value;
      grossAssets += value;
    } else if (account.type === "LOAN") {
      // Crédit : passif pur, pas d'actif associé
      const loanBalance = hasLoanParams(account)
        ? calcCurrentCapital(
            {
              loanAmountCents: account.loanAmountCents,
              loanTaeg: account.loanTaeg,
              loanDurationMonths: account.loanDurationMonths,
              loanDeferralMonths: account.loanDeferralMonths ?? 0,
              loanStartDate: account.loanStartDate,
            },
            now
          )
        : (account.liabilityCents ?? BigInt(0));
      totalLiabilities += loanBalance;
      value = -loanBalance; // affichage : montant négatif dans la liste des comptes
    } else {
      value = account.history[0]?.balanceCents ?? BigInt(0);
      if (account.type === "SAVINGS") allocation["Épargne"] += value;
      else allocation["Liquidités"] += value;
      grossAssets += value;
    }

    const instId = account.institutionId ?? "__personal__";
    if (!instMap.has(instId)) {
      const instName = account.institution?.name ?? "Personnel";
      instMap.set(instId, {
        name: instName,
        logoUrl: account.institution
          ? (account.institution.logoUrl ?? getInstitutionLogoUrl(instName))
          : null,
        total: BigInt(0),
        accounts: [],
      });
    }
    const inst = instMap.get(instId)!;
    inst.total += value;
    inst.accounts.push({ id: account.id, name: account.name, value, type: account.type });
  }

  const netWorth = grossAssets - totalLiabilities - totalLatentTax;
  const totalPassif = totalLiabilities + totalLatentTax;

  const institutions = [...instMap.values()].sort((a, b) => Number(b.total - a.total));

  // Daily history
  const allBalances = await prisma.historicalBalance.findMany({
    orderBy: { recordedAt: "asc" },
  });
  const allAccounts = await prisma.account.findMany({
    select: { id: true, liabilityCents: true },
  });
  const liabMap = new Map(allAccounts.map((a) => [a.id, a.liabilityCents ?? BigInt(0)]));

  const dayMap = new Map<string, Map<string, bigint>>();
  for (const b of allBalances) {
    const day = b.recordedAt.toISOString().slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    dayMap.get(day)!.set(b.accountId, b.balanceCents);
  }

  const sortedDays = [...dayMap.keys()].sort();
  const running = new Map<string, bigint>();
  const historyRaw: { day: string; netWorth: number }[] = [];

  for (const day of sortedDays) {
    for (const [id, v] of dayMap.get(day)!) running.set(id, v);
    let gross = BigInt(0);
    for (const v of running.values()) gross += v;
    let liab = BigInt(0);
    for (const [id, v] of liabMap) {
      if (running.has(id)) liab += v;
    }
    historyRaw.push({ day, netWorth: Number(gross - liab) });
  }

  const history = historyRaw.map(({ day, netWorth }) => {
    const [y, m, d] = day.split("-");
    return {
      date: new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(
        new Date(+y, +m - 1, +d)
      ),
      netWorth,
    };
  });

  // Delta 30 jours sur les comptes trackés (fiat + immobilier/auto via HistoricalBalance)
  let delta30: { amount: number; percent: number | null } | null = null;
  if (historyRaw.length >= 2) {
    const last = historyRaw[historyRaw.length - 1].netWorth;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const refIdx = Math.max(
      0,
      sortedDays.findLastIndex((d) => d <= thirtyDaysAgo)
    );
    const ref = historyRaw[refIdx].netWorth;
    const amount = last - ref;
    const percent = ref !== 0 ? (amount / Math.abs(ref)) * 100 : null;
    delta30 = { amount, percent };
  }

  const allocationSlices: AllocationSlice[] = [
    { name: "Liquidités", value: Number(allocation["Liquidités"]), color: "#6366f1" },
    { name: "Épargne", value: Number(allocation["Épargne"]), color: "#8b5cf6" },
    { name: "Investissements", value: Number(allocation["Investissements"]), color: "#22c55e" },
    { name: "Crypto", value: Number(allocation["Crypto"]), color: "#f59e0b" },
    { name: "Immobilier", value: Number(allocation["Immobilier"]), color: "#3b82f6" },
    { name: "Automobile", value: Number(allocation["Automobile"]), color: "#ec4899" },
  ];

  return { netWorth, grossAssets, totalPassif, totalLiabilities, totalLatentTax, history, allocationSlices, institutions, delta30 };
}

export default async function DashboardPage() {
  const { netWorth, grossAssets, totalPassif, totalLiabilities, totalLatentTax, history, allocationSlices, institutions, delta30 } =
    await getDashboardData();

  const hasData = grossAssets > BigInt(0);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <AutoSync />
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Dashboard</h1>
        <p className="text-sm text-[var(--muted)] mt-1">Vue d&apos;ensemble de votre patrimoine</p>
      </div>

      {/* Hero KPI */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 sm:p-8">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-3">Patrimoine Net</p>
        <p className="text-4xl sm:text-5xl font-bold tabular-nums text-[var(--accent)] break-all leading-none">
          {formatCurrency(netWorth, 0)}
        </p>
        {delta30 && (
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${
                delta30.amount >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"
              }`}
            >
              {delta30.amount >= 0 ? "▲" : "▼"}
              {formatCurrency(Math.abs(delta30.amount), 0)}
              {delta30.percent !== null && (
                <span className="font-normal opacity-80">
                  ({delta30.percent >= 0 ? "+" : ""}{delta30.percent.toFixed(1)}%)
                </span>
              )}
            </span>
            <span className="text-xs text-[var(--muted)]">sur 30 jours</span>
          </div>
        )}
        <div className="mt-5 pt-5 border-t border-[var(--border)] grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Brut</p>
            <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">
              {formatCurrency(grossAssets, 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Passif</p>
            <p className="text-lg font-semibold tabular-nums text-[var(--negative)]">
              {formatCurrency(totalPassif, 0)}
            </p>
            {totalPassif > BigInt(0) && (
              <div className="mt-0.5 space-y-0.5">
                {totalLiabilities > BigInt(0) && (
                  <p className="text-xs text-[var(--muted)]">Dettes {formatCurrency(totalLiabilities, 0)}</p>
                )}
                {totalLatentTax > BigInt(0) && (
                  <p className="text-xs text-[var(--muted)]">Fiscalité latente {formatCurrency(totalLatentTax, 0)}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts */}
      {hasData && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
              Évolution du patrimoine
            </h2>
            <NetWorthChart data={history} />
          </div>
          <div className="md:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6">
            <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-4">
              Répartition des actifs
            </h2>
            <AssetAllocationChart data={allocationSlices} />
          </div>
        </div>
      )}

      {/* Accounts overview */}
      {hasData ? (
        <div className="space-y-3">
          <h2 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
            Mes comptes
          </h2>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
            {institutions.map((inst) => (
              <div key={inst.name} className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <InstitutionLogo name={inst.name} logoUrl={inst.logoUrl} size={28} />
                    <p className="text-sm font-semibold text-[var(--foreground)]">{inst.name}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
                    {formatCurrency(inst.total, 0)}
                  </p>
                </div>
                <div className="space-y-0.5">
                  {inst.accounts.map((account) => (
                    <Link
                      key={account.id}
                      href={`/accounts/${account.id}`}
                      className="flex items-center justify-between text-xs group min-h-[44px] -mx-2 px-2 rounded-lg hover:bg-[var(--surface-elevated)] active:bg-[var(--border)] transition-colors"
                    >
                      <span className="text-[var(--muted)] group-hover:text-[var(--foreground)] transition-colors">
                        {account.name}
                      </span>
                      <span className="tabular-nums text-[var(--foreground)]">
                        {formatCurrency(account.value, 0)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            Commencez par ajouter vos institutions dans{" "}
            <Link href="/settings" className="text-[var(--accent)] underline underline-offset-2">
              Paramètres
            </Link>
            , puis vos comptes dans{" "}
            <Link href="/accounts" className="text-[var(--accent)] underline underline-offset-2">
              Comptes
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
