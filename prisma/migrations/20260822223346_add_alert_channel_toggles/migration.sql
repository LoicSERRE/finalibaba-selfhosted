-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "emailAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ntfyEnabled" BOOLEAN NOT NULL DEFAULT true;
