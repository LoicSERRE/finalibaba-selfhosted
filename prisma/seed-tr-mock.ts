/**
 * Seed mock Trade Republic data while pytr PR #327 is pending.
 * Run: npx tsx prisma/seed-tr-mock.ts
 * Remove with: npx tsx prisma/seed-tr-mock.ts --reset
 */
import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MOCK_ACCOUNTS = [
  {
    syncId: "tr:cash",
    name: "Compte espèces",
    type: "CHECKING" as const,
    balanceCents: BigInt(30037), // 300.37 € — real value from sync
  },
  {
    syncId: "tr:pea",
    name: "PEA",
    type: "INVESTMENT" as const,
    holdings: [
      { ticker: "IWDA", name: "iShares Core MSCI World ETF", quantity: "12.5", lastPriceCents: BigInt(9850) },
      { ticker: "PANW",  name: "Palo Alto Networks",          quantity: "3",    lastPriceCents: BigInt(32400) },
      { ticker: "ASML",  name: "ASML Holding",                quantity: "1.5",  lastPriceCents: BigInt(76200) },
    ],
  },
  {
    syncId: "tr:cto",
    name: "CTO",
    type: "INVESTMENT" as const,
    holdings: [
      { ticker: "NVDA",  name: "NVIDIA Corporation",  quantity: "5",   lastPriceCents: BigInt(87600) },
      { ticker: "AAPL",  name: "Apple Inc.",           quantity: "8",   lastPriceCents: BigInt(21300) },
      { ticker: "MSFT",  name: "Microsoft Corporation",quantity: "4",   lastPriceCents: BigInt(38900) },
    ],
  },
  {
    syncId: "tr:crypto",
    name: "Crypto",
    type: "CRYPTO" as const,
    holdings: [
      { ticker: "BTC", name: "Bitcoin",  quantity: "0.042", lastPriceCents: BigInt(8320000) },
      { ticker: "ETH", name: "Ethereum", quantity: "0.85",  lastPriceCents: BigInt(161000)  },
    ],
  },
];

async function main() {
  const reset = process.argv.includes("--reset");

  const institution = await prisma.institution.findFirst({
    where: { name: "Trade Republic" },
  });
  if (!institution) throw new Error("Institution 'Trade Republic' not found — run npm run db:seed first.");

  if (reset) {
    console.log("Removing mock TR accounts...");
    for (const acc of MOCK_ACCOUNTS) {
      const account = await prisma.account.findFirst({ where: { syncId: acc.syncId } });
      if (account) {
        await prisma.holding.deleteMany({ where: { accountId: account.id } });
        await prisma.historicalBalance.deleteMany({ where: { accountId: account.id } });
        await prisma.account.delete({ where: { id: account.id } });
        console.log(`  ✓ Removed: ${acc.name}`);
      }
    }
    console.log("Done — mock TR removed.");
    return;
  }

  console.log("Inserting mock Trade Republic accounts...");
  for (const acc of MOCK_ACCOUNTS) {
    // Upsert account
    let account = await prisma.account.findFirst({ where: { syncId: acc.syncId } });
    if (!account) {
      account = await prisma.account.create({
        data: {
          name: acc.name,
          type: acc.type,
          institutionId: institution.id,
          syncId: acc.syncId,
        },
      });
    }

    if ("balanceCents" in acc) {
      await prisma.historicalBalance.create({
        data: { accountId: account.id, balanceCents: acc.balanceCents! },
      });
    }

    if ("holdings" in acc) {
      for (const h of acc.holdings!) {
        await prisma.holding.upsert({
          where: { accountId_ticker: { accountId: account.id, ticker: h.ticker } },
          update: { name: h.name, quantity: h.quantity, lastPriceCents: h.lastPriceCents },
          create: {
            accountId: account.id,
            ticker: h.ticker,
            name: h.name,
            quantity: h.quantity,
            lastPriceCents: h.lastPriceCents,
          },
        });
      }
    }

    console.log(`  ✓ ${acc.name}`);
  }

  console.log("\nDone — mock TR inserted. To remove: npx tsx prisma/seed-tr-mock.ts --reset");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
