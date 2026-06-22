import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// gocardlessInstitutionId: GoCardless bank ID (undefined = no Open Banking sync)
const INSTITUTIONS: { name: string; gocardlessInstitutionId?: string }[] = [
  { name: "LCL", gocardlessInstitutionId: "LCL_CRLYFRPP" },
  { name: "BNP Paribas", gocardlessInstitutionId: "BNP_PARIBAS_BNPAFRPP" },
  { name: "Société Générale" },
  { name: "Crédit Agricole" },
  { name: "Boursorama" },
  { name: "Trade Republic" },
  { name: "Fortuneo" },
  { name: "Bourse Direct" },
  { name: "Edenred" },
  { name: "Coinbase" },
  { name: "Binance" },
  { name: "Kraken" },
];

async function main() {
  console.log("Seeding institutions…");
  for (const inst of INSTITUTIONS) {
    await prisma.institution.upsert({
      where: { name: inst.name },
      update: { gocardlessInstitutionId: inst.gocardlessInstitutionId },
      create: inst,
    });
  }
  console.log(`Done — ${INSTITUTIONS.length} institutions seeded.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
