-- Comptes courants d'associés (dev-docs/companies.md, step 2).
ALTER TABLE "CompanyAssociate" ADD COLUMN "currentAccountCents" BIGINT NOT NULL DEFAULT 0;
