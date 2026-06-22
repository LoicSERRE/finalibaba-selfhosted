-- Add investmentSubtype to Account (PEA / CTO)
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "investmentSubtype" TEXT;

-- Add costBasisCents to Holding (total acquisition cost)
ALTER TABLE "Holding" ADD COLUMN IF NOT EXISTS "costBasisCents" BIGINT;
