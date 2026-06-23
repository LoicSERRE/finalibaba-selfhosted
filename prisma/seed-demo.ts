import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EUR = (n: number) => BigInt(Math.round(n * 100));

function at(monthsBack: number, day = 1): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsBack);
  d.setDate(day);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function main() {
  console.log("Clearing existing data…");
  await prisma.syncLog.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.historicalBalance.deleteMany();
  await prisma.holding.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.account.deleteMany();
  await prisma.institution.deleteMany();

  // ── Institutions ─────────────────────────────────────────────────────────
  console.log("Creating institutions…");
  const bank = await prisma.institution.create({ data: { name: "LCL" } });
  const tr   = await prisma.institution.create({ data: { name: "Trade Republic" } });
  const cb   = await prisma.institution.create({ data: { name: "Coinbase" } });

  // ── Accounts ──────────────────────────────────────────────────────────────
  console.log("Creating accounts…");

  // Fiat
  const checking = await prisma.account.create({ data: { name: "Compte courant", type: "CHECKING",     institutionId: bank.id } });
  const ldds     = await prisma.account.create({ data: { name: "LDDS",           type: "SAVINGS",      institutionId: bank.id } });
  const livretA  = await prisma.account.create({ data: { name: "Livret A",       type: "SAVINGS",      institutionId: bank.id } });
  const tickets  = await prisma.account.create({ data: { name: "Tickets Restaurant", type: "MEAL_VOUCHER", institutionId: bank.id, manualValueCents: EUR(425) } });

  // Investments
  const pea = await prisma.account.create({ data: {
    name: "PEA",
    type: "INVESTMENT",
    institutionId: tr.id,
    investmentSubtype: "PEA",
    investmentStartDate: new Date("2021-01-15"),
  }});
  const cto = await prisma.account.create({ data: {
    name: "CTO",
    type: "INVESTMENT",
    institutionId: tr.id,
    investmentSubtype: "CTO",
    investmentStartDate: new Date("2022-06-01"),
  }});

  // Crypto
  const cryptoTR = await prisma.account.create({ data: {
    name: "Crypto",
    type: "CRYPTO",
    institutionId: tr.id,
    investmentStartDate: new Date("2023-01-10"),
  }});
  const btcCB = await prisma.account.create({ data: {
    name: "Bitcoin",
    type: "CRYPTO",
    institutionId: cb.id,
    investmentStartDate: new Date("2022-01-05"),
  }});

  // Immobilier & auto (IDs capturés pour l'historique)
  const appart  = await prisma.account.create({ data: { name: "Appartement — Paris 11e", type: "REAL_ESTATE", manualValueCents: EUR(295_000) } });
  const voiture = await prisma.account.create({ data: { name: "Hyundai i30N", type: "AUTOMOBILE", manualValueCents: EUR(24_000), purchasePriceCents: EUR(31_500) } });

  // Prêts (IDs capturés pour l'historique)
  const pretImmo = await prisma.account.create({ data: {
    name: "Prêt immobilier",
    type: "LOAN",
    loanAmountCents:    EUR(180_000),
    loanTaeg:           3.5,
    loanDurationMonths: 240,
    loanDeferralMonths: 0,
    loanStartDate:      new Date("2022-06-01"),
    insuranceMonthlyCents: EUR(45),
  }});
  const pretAuto = await prisma.account.create({ data: {
    name: "Prêt auto",
    type: "LOAN",
    loanAmountCents:    EUR(12_000),
    loanTaeg:           5.9,
    loanDurationMonths: 48,
    loanDeferralMonths: 0,
    loanStartDate:      new Date("2024-01-01"),
    insuranceMonthlyCents: EUR(15),
  }});

  // ── Holdings ──────────────────────────────────────────────────────────────
  // lastPriceCents = prix de seed réaliste (mis à jour ensuite par Yahoo Finance)
  // Tous les prix en €-cents (mid-2026)
  console.log("Creating holdings…");
  await prisma.holding.createMany({ data: [
    // PEA — trackers monde
    // IWDA.L (iShares MSCI World, LSE) ≈ 113 € · CSPX.L (S&P 500, LSE) ≈ 618 €
    { accountId: pea.id, ticker: "IWDA.L", name: "iShares Core MSCI World ETF",  quantity: "45",   lastPriceCents: EUR(113),    costBasisCents: EUR(3_798) },
    { accountId: pea.id, ticker: "CSPX.L", name: "iShares Core S&P 500 ETF",     quantity: "20",   lastPriceCents: EUR(618),    costBasisCents: EUR(10_240) },
    // CTO — actions US (prix en EUR après change USD/EUR ≈ 0.92)
    // AAPL ≈ 200 $ → 184 € · MSFT ≈ 470 $ → 432 €
    { accountId: cto.id, ticker: "AAPL",   name: "Apple Inc.",                    quantity: "15",   lastPriceCents: EUR(184),    costBasisCents: EUR(2_370) },
    { accountId: cto.id, ticker: "MSFT",   name: "Microsoft Corp.",               quantity: "10",   lastPriceCents: EUR(432),    costBasisCents: EUR(3_480) },
    // Crypto — BTC ≈ 92 000 € · ETH ≈ 3 400 €
    { accountId: cryptoTR.id, ticker: "BTC-EUR", name: "Bitcoin",   quantity: "0.12", lastPriceCents: EUR(92_000), costBasisCents: EUR(5_400) },
    { accountId: cryptoTR.id, ticker: "ETH-EUR", name: "Ethereum",  quantity: "1.5",  lastPriceCents: EUR(3_400),  costBasisCents: EUR(4_200) },
    { accountId: btcCB.id,    ticker: "BTC-EUR", name: "Bitcoin",   quantity: "0.05", lastPriceCents: EUR(92_000), costBasisCents: EUR(1_500) },
  ]});

  // ── Historical balances — 24 months ───────────────────────────────────────
  // [checking, ldds, livretA, tickets] — index 0 = oldest (23 months back)
  console.log("Creating historical balances (24 months)…");
  const history: [number, number, number, number][] = [
    [2_500, 5_800,  8_200, 420],
    [2_800, 5_920,  8_360, 435],
    [3_200, 6_040,  8_530, 410],
    [2_100, 6_140,  8_700, 445],
    [3_100, 6_270,  8_860, 380],
    [2_700, 6_400,  9_030, 425],
    [3_400, 6_520,  9_200, 400],
    [2_600, 6_650,  9_360, 430],
    [3_000, 6_780,  9_530, 415],
    [2_800, 6_900,  9_700, 440],
    [3_300, 7_020,  9_860, 395],
    [2_500, 7_150, 10_030, 420],
    [3_100, 7_250, 10_190, 430],
    [2_900, 7_380, 10_360, 410],
    [3_400, 7_500, 10_520, 445],
    [2_700, 7_600, 10_680, 425],
    [3_000, 7_720, 10_840, 400],
    [3_200, 7_850, 11_000, 420],
    [2_800, 7_970, 11_160, 415],
    [3_400, 8_080, 11_330, 435],
    [3_100, 8_200, 11_490, 440],
    [2_900, 8_320, 11_660, 425],
    [3_200, 8_420, 11_820, 410],
    [3_200, 8_500, 12_000, 425],
  ];

  // Prêt immo : capital restant approx à chaque mois (négatif = passif dans le graphique)
  // Démarré juin 2022 — au mois 23 (juillet 2024) ≈ 170k restant → aujourd'hui ≈ 158k
  const mortgageAtOldest = 170_000;
  const mortgageAtNow    = 158_000;

  // Prêt auto : démarré jan 2024 — au mois 23 (juillet 2024, 6 mois) ≈ 10 500 → aujourd'hui ≈ 7 500
  const carLoanAtOldest = 10_500;
  const carLoanAtNow    = 7_500;

  // Voiture : achetée jan 2024 pour 31 500 → 24 000 aujourd'hui (6k sur ~30 mois ≈ 200€/mois)
  const carAtOldest = 30_000; // 6 mois après achat (juillet 2024)
  const carAtNow    = 24_000;

  const N = history.length - 1; // = 23

  for (let i = 0; i < history.length; i++) {
    const monthsBack = history.length - 1 - i;
    const t = i / N; // 0 = oldest, 1 = most recent
    const [ch, ld, la, tk] = history[i];

    // Valeurs interpolées linéairement
    const aptVal      = EUR(295_000); // appartement constant
    const carVal      = EUR(Math.round(carAtOldest + t * (carAtNow - carAtOldest)));
    const mortgageVal = EUR(-Math.round(mortgageAtOldest + t * (mortgageAtNow - mortgageAtOldest)));
    const carLoanVal  = EUR(-Math.round(carLoanAtOldest + t * (carLoanAtNow - carLoanAtOldest)));

    await prisma.historicalBalance.createMany({ data: [
      // Comptes fiat
      { accountId: checking.id, balanceCents: EUR(ch),      recordedAt: at(monthsBack) },
      { accountId: ldds.id,     balanceCents: EUR(ld),      recordedAt: at(monthsBack) },
      { accountId: livretA.id,  balanceCents: EUR(la),      recordedAt: at(monthsBack) },
      { accountId: tickets.id,  balanceCents: EUR(tk),      recordedAt: at(monthsBack) },
      // Patrimoine physique
      { accountId: appart.id,   balanceCents: aptVal,       recordedAt: at(monthsBack) },
      { accountId: voiture.id,  balanceCents: carVal,       recordedAt: at(monthsBack) },
      // Passifs (valeurs négatives → soustraits du patrimoine net historique)
      { accountId: pretImmo.id, balanceCents: mortgageVal,  recordedAt: at(monthsBack) },
      { accountId: pretAuto.id, balanceCents: carLoanVal,   recordedAt: at(monthsBack) },
    ]});
  }

  // ── Transactions — 9 months ───────────────────────────────────────────────
  console.log("Creating transactions (9 months)…");

  // Per-month amounts — deterministic values to avoid floating point issues
  const monthly = [
    // [groceries1, groceries2, edf, resto]
    { g1: 145, g2: 112, edf: 78,  resto: 48  },
    { g1: 132, g2:  98, edf: 82,  resto: 35  },
    { g1: 168, g2: 134, edf: 91,  resto: 62  },
    { g1: 121, g2:  96, edf: 85,  resto: 41  },
    { g1: 155, g2: 118, edf: 74,  resto: 55  },
    { g1: 142, g2: 105, edf: 88,  resto: 38  },
    { g1: 158, g2: 121, edf: 79,  resto: 52  },
    { g1: 138, g2: 102, edf: 93,  resto: 44  },
    { g1: 149, g2: 108, edf: 81,  resto: 60  },
  ];

  const txRows = [];
  for (let m = 8; m >= 0; m--) {
    const idx = 8 - m;
    const mv = monthly[idx];
    txRows.push(
      // Compte courant — revenus
      { accountId: checking.id, syncId: `demo:salary:${m}`,    date: at(m, 28), label: "VIR SALAIRE — EMPRESA SAS",          amountCents: EUR(3_800)       },
      // Compte courant — dépenses fixes
      { accountId: checking.id, syncId: `demo:ldds:${m}`,      date: at(m,  1), label: "VIR LDDS",                           amountCents: EUR(-500)        },
      { accountId: checking.id, syncId: `demo:pea:${m}`,       date: at(m,  3), label: "VIR PEA TRADE REPUBLIC",             amountCents: EUR(-200)        },
      { accountId: checking.id, syncId: `demo:mortgage:${m}`,  date: at(m,  5), label: "PRELEVEMENT CREDIT HABITAT",         amountCents: EUR(-820)        },
      { accountId: checking.id, syncId: `demo:carloan:${m}`,   date: at(m,  8), label: "PRELEVEMENT CREDIT AUTO",            amountCents: EUR(-280)        },
      { accountId: checking.id, syncId: `demo:edf:${m}`,       date: at(m, 10), label: "PRELEVEMENT EDF",                    amountCents: EUR(-mv.edf)     },
      { accountId: checking.id, syncId: `demo:sfr:${m}`,       date: at(m, 12), label: "PRELEVEMENT SFR MOBILE",             amountCents: EUR(-35)         },
      { accountId: checking.id, syncId: `demo:internet:${m}`,  date: at(m, 13), label: "PRELEVEMENT FREE INTERNET",          amountCents: EUR(-30)         },
      { accountId: checking.id, syncId: `demo:assurance:${m}`, date: at(m, 15), label: "PRELEVEMENT MAIF ASSURANCES",        amountCents: EUR(-85)         },
      { accountId: checking.id, syncId: `demo:courses1:${m}`,  date: at(m,  9), label: "CARREFOUR MARKET",                   amountCents: EUR(-mv.g1)      },
      { accountId: checking.id, syncId: `demo:courses2:${m}`,  date: at(m, 20), label: "LIDL",                               amountCents: EUR(-mv.g2)      },
      { accountId: checking.id, syncId: `demo:netflix:${m}`,   date: at(m, 16), label: "NETFLIX.COM",                        amountCents: EUR(-16)         },
      { accountId: checking.id, syncId: `demo:resto:${m}`,     date: at(m, 22), label: "RESTAURANT LE PETIT BISTROT",        amountCents: EUR(-mv.resto)   },
      // LDDS — virement mensuel reçu
      { accountId: ldds.id,     syncId: `demo:ldds:recv:${m}`, date: at(m,  2), label: "VIR RECU COMPTE COURANT",            amountCents: EUR(500)         },
    );
  }
  // Remboursement impôts — ponctuel
  txRows.push(
    { accountId: checking.id, syncId: "demo:impots:remb", date: at(3, 15), label: "REMBOURSEMENT IMPOTS DGFiP", amountCents: EUR(820) },
  );
  await prisma.transaction.createMany({ data: txRows });

  // ── User settings ─────────────────────────────────────────────────────────
  console.log("Creating user settings…");
  await prisma.userSettings.upsert({
    where:  { id: "singleton" },
    update: {
      salaryNetCents:       EUR(3_800),
      monthlyExpensesCents: EUR(2_350),
      savingsGoalCents:     EUR(500_000),
      monthlySavedCents:    EUR(950),
    },
    create: {
      id: "singleton",
      salaryNetCents:       EUR(3_800),
      monthlyExpensesCents: EUR(2_350),
      savingsGoalCents:     EUR(500_000),
      monthlySavedCents:    EUR(950),
    },
  });

  console.log("Done — demo data seeded.");
  const peaVal    = 45 * 113 + 20 * 618;
  const ctoVal    = 15 * 184 + 10 * 432;
  const cryptoVal = 0.17 * 92_000 + 1.5 * 3_400;
  const gross     = Math.round(24_100 + peaVal + ctoVal + cryptoVal + 295_000 + 24_000);
  const net       = Math.round(gross - 158_000 - 7_500);
  console.log("Portfolio overview (prix seedés — mis à jour par Yahoo Finance ensuite) :");
  console.log(`  Fiat    :  ~24 100 €`);
  console.log(`  PEA     :  ~${peaVal.toLocaleString("fr-FR")} €  (45×IWDA.L + 20×CSPX.L)`);
  console.log(`  CTO     :  ~${ctoVal.toLocaleString("fr-FR")} €   (15×AAPL + 10×MSFT)`);
  console.log(`  Crypto  :  ~${Math.round(cryptoVal).toLocaleString("fr-FR")} €  (0,17 BTC + 1,5 ETH)`);
  console.log(`  Immo    :  295 000 €  |  Prêt ~158 k€ restant`);
  console.log(`  Auto    :   24 000 €  |  Prêt auto ~7,5 k€ restant`);
  console.log(`  BRUT    :  ~${gross.toLocaleString("fr-FR")} €`);
  console.log(`  NET     :  ~${net.toLocaleString("fr-FR")} € (après prêts, avant impôts latents)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
