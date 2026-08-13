-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "loanPaidOffAlertSent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "alertEmailTo" TEXT,
ADD COLUMN     "lastSyncFailureAlertCheckedAt" TIMESTAMP(3),
ADD COLUMN     "netWorthAlertLastAbove" BOOLEAN,
ADD COLUMN     "netWorthAlertThresholdCents" BIGINT,
ADD COLUMN     "ntfyTopicUrl" TEXT,
ADD COLUMN     "smtpFrom" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPassword" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpUser" TEXT;
