-- Dated cap tables (dev-docs/companies.md, step 5).
CREATE TYPE "CapTableChangeKind" AS ENUM ('CREATION', 'CESSION', 'DONATION', 'CAPITAL_CHANGE', 'CORRECTION');

CREATE TABLE "CompanyCapTableVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "totalParts" INTEGER NOT NULL,
    "kind" "CapTableChangeKind" NOT NULL DEFAULT 'CORRECTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyCapTableVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyCapTableVersion_companyId_effectiveFrom_key" ON "CompanyCapTableVersion"("companyId", "effectiveFrom");

ALTER TABLE "CompanyCapTableVersion" ADD CONSTRAINT "CompanyCapTableVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyCapTableVersion" ADD CONSTRAINT "CompanyCapTableVersion_totalParts_check" CHECK ("totalParts" > 0);

-- Every existing company's cap table becomes its first version, standing
-- "since the origin" (1900-01-01, CAP_TABLE_ORIGIN in lib/domain/company.ts):
-- every past day is valued with it, exactly as until now, and any dated
-- change recorded later comes after it. Nothing changes for them.
INSERT INTO "CompanyCapTableVersion" ("id", "companyId", "effectiveFrom", "totalParts", "kind")
SELECT md5(random()::text || c.id) || 'cv1', c.id, TIMESTAMP '1900-01-01 00:00:00', c."totalParts", 'CREATION'
FROM "Company" c;

ALTER TABLE "CompanyHolding" ADD COLUMN "versionId" TEXT;
UPDATE "CompanyHolding" h SET "versionId" = v.id FROM "CompanyCapTableVersion" v WHERE v."companyId" = h."companyId";
ALTER TABLE "CompanyHolding" ALTER COLUMN "versionId" SET NOT NULL;
ALTER TABLE "CompanyHolding" ADD CONSTRAINT "CompanyHolding_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CompanyCapTableVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CompanyHolding_versionId_idx" ON "CompanyHolding"("versionId");
