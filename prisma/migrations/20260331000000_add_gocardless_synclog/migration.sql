-- Add GoCardless fields to Institution
ALTER TABLE "Institution" ADD COLUMN IF NOT EXISTS "gocardlessInstitutionId" TEXT;
ALTER TABLE "Institution" ADD COLUMN IF NOT EXISTS "gocardlessRequisitionId" TEXT;

-- Add syncId and gocardlessAccountId to Account
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "syncId" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "gocardlessAccountId" TEXT;

-- Add unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "Account_syncId_key" ON "Account"("syncId");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_gocardlessAccountId_key" ON "Account"("gocardlessAccountId");

-- Create SyncLog table
CREATE TABLE IF NOT EXISTS "SyncLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);
