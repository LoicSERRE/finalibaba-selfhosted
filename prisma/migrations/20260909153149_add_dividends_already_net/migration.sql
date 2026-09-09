-- Some brokers (reported for Trade Republic) withhold both the foreign
-- treaty rate AND the French social levies before a dividend reaches the
-- account, unlike a plain custodian that only withholds the treaty rate and
-- leaves French tax for the annual return. The dividend-calendar estimate
-- (lib/domain/analytics.ts's dividendEffectiveTaxRate) assumed the latter
-- unconditionally, double-counting the deduction for a broker that already
-- nets everything out. Per-account, defaulting to false so every existing
-- account's displayed figure is unchanged until the user opts a specific
-- account in.
ALTER TABLE "Account" ADD COLUMN "dividendsAlreadyNet" BOOLEAN NOT NULL DEFAULT false;
