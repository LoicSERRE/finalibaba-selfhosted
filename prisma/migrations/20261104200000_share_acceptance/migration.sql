-- A co-ownership or a portfolio grant now waits for the invited user to
-- accept it; until then (acceptedAt NULL) it has no effect at all.
ALTER TABLE "AccountCoOwner" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "PortfolioGrant" ADD COLUMN "acceptedAt" TIMESTAMP(3);

-- Shares that already exist were set up before anyone was asked, and people
-- rely on them: they stay active rather than silently disappearing.
UPDATE "AccountCoOwner" SET "acceptedAt" = "createdAt";
UPDATE "PortfolioGrant" SET "acceptedAt" = "createdAt";
