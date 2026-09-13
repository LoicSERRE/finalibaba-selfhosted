-- Three things the post-v2.0 security audit left open, plus the one it had no
-- way to name: an instance with several real users had no record of what
-- anyone did on it.

-- Ends a session without deleting the account. Until now the only way to stop
-- somebody's 30-day JWT was to delete them, which cascades their entire
-- portfolio - so a stolen phone meant choosing between a live session and
-- destroying real data.
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);

-- A policy each person opts into individually is not a policy. Default false,
-- so no existing instance locks its own users out the moment it upgrades.
ALTER TABLE "InstanceSettings" ADD COLUMN "requireTwoFactor" BOOLEAN NOT NULL DEFAULT false;

-- actorId is a plain column and NOT a foreign key, deliberately: deleting a
-- user must not erase the record of what they did, which is precisely when
-- this table earns its keep.
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "detail" TEXT,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- Attempt counters that survive a restart. The in-memory limiter this backs
-- reset on every container restart, so anything that could crash-loop the app
-- also cleared the brake on guessing a password.
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit"("resetAt");
