/*
  Warnings:

  - You are about to drop the column `lastSyncFailureAlertCheckedAt` on the `UserSettings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "UserSettings" DROP COLUMN "lastSyncFailureAlertCheckedAt";

-- CreateTable
CREATE TABLE "SyncFailureState" (
    "source" TEXT NOT NULL,
    "brokenSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAlertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncFailureState_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE INDEX "SyncLog_source_createdAt_idx" ON "SyncLog"("source", "createdAt");
