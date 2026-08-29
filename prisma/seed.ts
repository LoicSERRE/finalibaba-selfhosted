import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Declared here rather than imported from lib/domain/users.ts: the production
// image ships prisma/ but deliberately not lib/ (see the runner stage in
// Dockerfile), so `import { OWNER_USER_ID } from "../lib/domain/users"` throws
// MODULE_NOT_FOUND the moment this runs inside a container. It did, on the
// v2.0.0 demo deploy.
//
// The value is already a literal in schema.prisma's own @default() 15 times
// over - Prisma cannot reference TypeScript - so this is one more copy of a
// string that has no single source of truth to begin with.
// __tests__/owner-id-consistency.test.ts fails if any of them drift apart, and
// the "No owner user found" guard below turns a mismatch into an immediate,
// explicit error rather than silently seeding orphaned rows.
const OWNER_USER_ID = "user-owner";

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

// Institution names are unique per user as of v2.0, so the reference set is
// seeded for the instance owner - the same user every pre-v2 row was
// backfilled to, and the one the Python sync sidecar's env-driven sources
// (LCL/Trade Republic) write under. Other users create their own
// institutions from the Settings UI.
async function main() {
  console.log("Seeding institutions…");
  for (const inst of INSTITUTIONS) {
    await prisma.institution.upsert({
      where: { userId_name: { userId: OWNER_USER_ID, name: inst.name } },
      update: { gocardlessInstitutionId: inst.gocardlessInstitutionId },
      create: { ...inst, userId: OWNER_USER_ID },
    });
  }
  console.log(`Done - ${INSTITUTIONS.length} institutions seeded.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
