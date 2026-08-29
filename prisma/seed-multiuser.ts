import "dotenv/config";
import bcrypt from "bcryptjs";
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

/**
 * Local development seed for the v2.0 multi-user surfaces.
 *
 * ADDITIVE - unlike seed-demo.ts this wipes nothing. Run it on top of an
 * already-seeded database (`pnpm run db:seed:demo` first) to get a second
 * account, a co-owned account and a portfolio share, so the switcher, the
 * co-owner panel and the read-only mode can be exercised without hand-writing
 * SQL every time.
 *
 * Deliberately NOT folded into seed-demo.ts: docker-compose.demo.yml runs the
 * public demo with AUTH_ENABLED=false, where a second user has no login, no
 * switcher and no user list. Their accounts would be correctly invisible on
 * every page - data nobody can reach, which is confusing to seed and worse to
 * debug. The demo stays single-user on purpose.
 *
 * Refuses to run unless SEED_MULTIUSER_PASSWORD is set: this creates a real,
 * loginable account, and a hardcoded default password in a repo that people
 * self-host is exactly the kind of thing that quietly ends up in production.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EUR = (n: number) => BigInt(Math.round(n * 100));
const BCRYPT_ROUNDS = 10;

const MEMBER_USERNAME = "member";
const MEMBER_ID = "user-demo-member";

async function main() {
  const password = process.env.SEED_MULTIUSER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error(
      "Set SEED_MULTIUSER_PASSWORD (8+ chars) before running this - it becomes a real login password\n" +
        "for both seeded accounts:\n\n" +
        "  SEED_MULTIUSER_PASSWORD=<your choice> pnpm run db:seed:multiuser\n"
    );
  }

  const owner = await prisma.user.findUnique({
    where: { id: OWNER_USER_ID },
    select: { id: true, username: true, passwordHash: true },
  });
  if (!owner) {
    throw new Error(
      "No owner user found - run `pnpm exec prisma migrate deploy` first (the v2.0 migration creates it)."
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // The owner needs credentials too, or there is nobody to log in AS to see
  // the sharing UI from the other side. Only filled in when absent, so this
  // never overwrites a password someone already chose.
  if (!owner.passwordHash) {
    await prisma.user.update({
      where: { id: OWNER_USER_ID },
      data: { username: owner.username ?? "owner", displayName: "Owner", passwordHash, role: "ADMIN" },
    });
    console.log(`Owner credentials set - login: ${owner.username ?? "owner"}`);
  } else {
    console.log("Owner already has a password - left untouched.");
  }

  const member = await prisma.user.upsert({
    where: { id: MEMBER_ID },
    create: {
      id: MEMBER_ID,
      username: MEMBER_USERNAME,
      displayName: "Member",
      passwordHash,
      role: "MEMBER",
    },
    update: { passwordHash },
  });
  console.log(`Member account ready - login: ${MEMBER_USERNAME}`);

  // A portfolio of their own, so "each user is isolated" is visible rather
  // than just asserted: logging in as the member shows THIS, not the owner's.
  const bank = await prisma.institution.upsert({
    where: { userId_name: { userId: member.id, name: "Boursorama" } },
    create: { userId: member.id, name: "Boursorama" },
    update: {},
  });

  const existing = await prisma.account.findFirst({
    where: { userId: member.id, name: "Compte courant" },
    select: { id: true },
  });
  if (!existing) {
    const checking = await prisma.account.create({
      data: { userId: member.id, name: "Compte courant", type: "CHECKING", institutionId: bank.id },
    });
    const savings = await prisma.account.create({
      data: { userId: member.id, name: "Livret A", type: "SAVINGS", institutionId: bank.id },
    });
    await prisma.historicalBalance.createMany({
      data: [
        { accountId: checking.id, balanceCents: EUR(1_240), recordedAt: new Date() },
        { accountId: savings.id, balanceCents: EUR(6_800), recordedAt: new Date() },
      ],
    });
    console.log("Member portfolio created (2 accounts).");
  } else {
    console.log("Member portfolio already exists - left untouched.");
  }

  // Co-ownership: one of the OWNER's accounts, shared read-write. Picks a
  // savings account because a joint Livret/LDDS is the real-world case this
  // was built for.
  const joint = await prisma.account.findFirst({
    where: { userId: OWNER_USER_ID, type: "SAVINGS" },
    select: { id: true, name: true },
  });
  if (joint) {
    await prisma.accountCoOwner.upsert({
      where: { accountId_userId: { accountId: joint.id, userId: member.id } },
      create: { accountId: joint.id, userId: member.id },
      update: {},
    });
    console.log(`Co-ownership: "${joint.name}" is now shared read-write with ${MEMBER_USERNAME}.`);
  } else {
    console.log("No SAVINGS account on the owner - skipped co-ownership (run db:seed:demo first).");
  }

  // Portfolio share: the member can READ everything the owner owns. This is
  // what puts the switcher in their sidebar.
  await prisma.portfolioGrant.upsert({
    where: {
      grantorUserId_granteeUserId: { grantorUserId: OWNER_USER_ID, granteeUserId: member.id },
    },
    create: { grantorUserId: OWNER_USER_ID, granteeUserId: member.id },
    update: {},
  });
  console.log(`Portfolio share: ${MEMBER_USERNAME} can read the owner's portfolio (read-only).`);

  console.log("\nDone. Start the app with AUTH_ENABLED=true and log in as either account.");
  console.log("  - the switcher at the top of the sidebar appears for the member only");
  console.log("  - selecting the owner's portfolio shows their data with every edit control gone");
  console.log("  - the co-owned savings account appears in BOTH portfolios, editable in both");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
