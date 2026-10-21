-- A loan whose money still sits on the user's accounts (v2.20): only those are
-- taken out of savings for the own-funds runway.
ALTER TABLE "Account" ADD COLUMN "loanFundsOnAccounts" BOOLEAN NOT NULL DEFAULT false;
