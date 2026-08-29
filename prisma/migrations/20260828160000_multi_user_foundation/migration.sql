-- v2.0 multi-user foundation.
--
-- ORDERING IS LOAD-BEARING and differs from what `prisma migrate diff`
-- generates on its own: that output adds every foreign key at the very end,
-- after the userId columns have already been backfilled to 'user-owner' -
-- but the User row with that id doesn't exist yet at that point, so every
-- single FK would fail on an instance with real data. The owner row is
-- therefore created (step 2) before any column referencing it exists, and
-- the FKs come last, once every row already points at something real.
--
-- The whole file is one transaction (Prisma wraps each migration), so an
-- instance either lands fully on v2 or stays untouched on v1.

-- ── 1. New enums & tables ───────────────────────────────────────────────────

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appLockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "appLockChallenge" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstanceSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "vapidPublicKey" TEXT,
    "vapidPrivateKey" TEXT,

    CONSTRAINT "InstanceSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountCoOwner" (
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountCoOwner_pkey" PRIMARY KEY ("accountId","userId")
);

CREATE TABLE "PortfolioGrant" (
    "grantorUserId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioGrant_pkey" PRIMARY KEY ("grantorUserId","granteeUserId")
);

-- ── 2. The owner row - created BEFORE anything references it ────────────────
--
-- Fixed id, matching OWNER_USER_ID in lib/auth-context.ts. Deliberately
-- created with NO credentials: in mono mode (AUTH_ENABLED unset) nothing
-- ever needs them, and when an existing instance switches auth on later,
-- the bootstrap screen sets username/passwordHash ON THIS ROW - which is
-- what makes "your existing data is attached to your new admin account"
-- automatic rather than a data-moving operation that could go wrong.
-- ADMIN because the instance's first user manages users/invitations/backup.
--
-- ON CONFLICT DO NOTHING so re-running against a DB that somehow already
-- has it (a partially-applied restore) is a no-op rather than a hard error.
INSERT INTO "User" ("id", "displayName", "role", "createdAt")
VALUES ('user-owner', NULL, 'ADMIN', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ── 3. Ownership columns (backfilled by their own DEFAULT) ──────────────────
--
-- Every pre-existing row belongs to the owner. The DEFAULT does the backfill
-- for us: adding a NOT NULL column with a default rewrites existing rows
-- with that value, so no separate UPDATE pass is needed.
--
-- On Account and SyncLog the DEFAULT is PERMANENT, not scaffolding:
-- sync/db.py INSERTs both tables with raw SQL and explicit column lists that
-- know nothing about userId. Keeping the default is precisely what lets the
-- Python sidecar keep working with zero code changes, and env-synced
-- (LCL/Trade Republic) data belonging to the owner is the intended
-- semantics - see CLAUDE.md's "Multi-user architecture".

ALTER TABLE "Institution"       ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "Account"           ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "Category"          ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "Goal"              ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "AlertRule"         ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "ShareLink"         ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "ApiKey"            ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "AppLockCredential" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "PushSubscription"  ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';
ALTER TABLE "SyncLog"           ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner';

-- SyncFailureState's primary key becomes (userId, source): keyed on source
-- alone, two users each syncing their own LCL would share one dedup row, so
-- one user's alert would silence the other's.
ALTER TABLE "SyncFailureState" DROP CONSTRAINT "SyncFailureState_pkey",
    ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner',
    ADD CONSTRAINT "SyncFailureState_pkey" PRIMARY KEY ("userId", "source");

-- UserSettings becomes one row per user. The legacy singleton row keeps its
-- id ('singleton') and is simply re-pointed at the owner; only the id's
-- DEFAULT goes away, since new rows now get a cuid from Prisma.
ALTER TABLE "UserSettings" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'user-owner',
    ALTER COLUMN "id" DROP DEFAULT;

-- ── 4. Move singleton-scoped data onto its real owner ───────────────────────
--
-- TOTP and app-lock are per-person, so they move to the owner's User row.
-- The source columns stay in place as vestigial (this repo's
-- non-destructive-migration convention, same as savingsGoalCents), so a
-- rollback or a forensic look at the old values is still possible.

UPDATE "User" u
SET "totpSecret"       = s."totpSecret",
    "totpEnabled"      = s."totpEnabled",
    "totpBackupCodes"  = s."totpBackupCodes",
    "appLockEnabled"   = s."appLockEnabled",
    "appLockChallenge" = s."appLockChallenge"
FROM "UserSettings" s
WHERE u."id" = 'user-owner' AND s."id" = 'singleton';

-- VAPID keys identify the SERVER to push services, not a person - they
-- become instance-level. COALESCE against a fresh install where no
-- UserSettings row exists yet: the row is still created, just empty, so
-- getOrCreateVapidKeys() has somewhere to write on first use.
INSERT INTO "InstanceSettings" ("id", "vapidPublicKey", "vapidPrivateKey")
VALUES (
    'singleton',
    (SELECT "vapidPublicKey"  FROM "UserSettings" WHERE "id" = 'singleton'),
    (SELECT "vapidPrivateKey" FROM "UserSettings" WHERE "id" = 'singleton')
)
ON CONFLICT ("id") DO NOTHING;

-- ── 5. Indexes: global-name uniques become per-user ─────────────────────────

DROP INDEX "Institution_name_key";
DROP INDEX "Category_name_key";

CREATE UNIQUE INDEX "User_username_key"           ON "User"("username");
CREATE UNIQUE INDEX "Invitation_token_key"        ON "Invitation"("token");
CREATE UNIQUE INDEX "Institution_userId_name_key" ON "Institution"("userId", "name");
CREATE UNIQUE INDEX "Category_userId_name_key"    ON "Category"("userId", "name");
CREATE UNIQUE INDEX "UserSettings_userId_key"     ON "UserSettings"("userId");

CREATE INDEX "Institution_userId_idx"             ON "Institution"("userId");
CREATE INDEX "Account_userId_idx"                 ON "Account"("userId");
CREATE INDEX "Category_userId_idx"                ON "Category"("userId");
CREATE INDEX "Goal_userId_idx"                    ON "Goal"("userId");
CREATE INDEX "AlertRule_userId_idx"               ON "AlertRule"("userId");
CREATE INDEX "ShareLink_userId_idx"               ON "ShareLink"("userId");
CREATE INDEX "ApiKey_userId_idx"                  ON "ApiKey"("userId");
CREATE INDEX "AppLockCredential_userId_idx"       ON "AppLockCredential"("userId");
CREATE INDEX "PushSubscription_userId_idx"        ON "PushSubscription"("userId");
CREATE INDEX "SyncLog_userId_source_createdAt_idx" ON "SyncLog"("userId", "source", "createdAt");

-- ── 6. Foreign keys - last, once every row points at a real User ────────────

ALTER TABLE "Invitation"        ADD CONSTRAINT "Invitation_createdByUserId_fkey"  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountCoOwner"    ADD CONSTRAINT "AccountCoOwner_accountId_fkey"    FOREIGN KEY ("accountId")       REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountCoOwner"    ADD CONSTRAINT "AccountCoOwner_userId_fkey"       FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioGrant"    ADD CONSTRAINT "PortfolioGrant_grantorUserId_fkey" FOREIGN KEY ("grantorUserId")  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioGrant"    ADD CONSTRAINT "PortfolioGrant_granteeUserId_fkey" FOREIGN KEY ("granteeUserId")  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Institution"       ADD CONSTRAINT "Institution_userId_fkey"          FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Account"           ADD CONSTRAINT "Account_userId_fkey"              FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncLog"           ADD CONSTRAINT "SyncLog_userId_fkey"              FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncFailureState"  ADD CONSTRAINT "SyncFailureState_userId_fkey"     FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertRule"         ADD CONSTRAINT "AlertRule_userId_fkey"            FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Goal"              ADD CONSTRAINT "Goal_userId_fkey"                 FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category"          ADD CONSTRAINT "Category_userId_fkey"             FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSettings"      ADD CONSTRAINT "UserSettings_userId_fkey"         FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareLink"         ADD CONSTRAINT "ShareLink_userId_fkey"            FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiKey"            ADD CONSTRAINT "ApiKey_userId_fkey"               FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppLockCredential" ADD CONSTRAINT "AppLockCredential_userId_fkey"    FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription"  ADD CONSTRAINT "PushSubscription_userId_fkey"     FOREIGN KEY ("userId")          REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
