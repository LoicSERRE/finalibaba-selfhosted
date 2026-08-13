-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "loanAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "syncFailureAlertsEnabled" BOOLEAN NOT NULL DEFAULT true;
