-- Net book value of a company's building under corporate tax (step 4).
ALTER TABLE "Account" ADD COLUMN "bookValueCents" BIGINT;
ALTER TABLE "Account" ADD CONSTRAINT "Account_bookValueCents_check" CHECK ("bookValueCents" IS NULL OR "bookValueCents" >= 0);
