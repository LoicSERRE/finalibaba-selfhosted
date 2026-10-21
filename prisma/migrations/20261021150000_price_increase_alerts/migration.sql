-- Price increases on recurring expenses (v2.20): the price last alerted
-- about, and the alert's toggle.
ALTER TABLE "RecurringTransaction" ADD COLUMN "priceAlertedCents" BIGINT;
ALTER TABLE "UserSettings" ADD COLUMN "priceIncreaseAlertsEnabled" BOOLEAN NOT NULL DEFAULT true;
