-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "discountPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "CompanyAssociate" ADD COLUMN     "birthDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CompanyHolding" ADD COLUMN     "bareOwnerId" TEXT,
ADD COLUMN     "usufructuaryId" TEXT,
ALTER COLUMN "fullOwnerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CompanyHolding" ADD CONSTRAINT "CompanyHolding_usufructuaryId_fkey" FOREIGN KEY ("usufructuaryId") REFERENCES "CompanyAssociate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHolding" ADD CONSTRAINT "CompanyHolding_bareOwnerId_fkey" FOREIGN KEY ("bareOwnerId") REFERENCES "CompanyAssociate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A block is owned outright, or split between two DIFFERENT associates -
-- never a mix, never nobody. Prisma has no syntax for it; the actions check
-- it first (validateCapTable), this is the floor under them.
ALTER TABLE "CompanyHolding" ADD CONSTRAINT "CompanyHolding_shape_check" CHECK (
    ("fullOwnerId" IS NOT NULL AND "usufructuaryId" IS NULL AND "bareOwnerId" IS NULL)
    OR ("fullOwnerId" IS NULL AND "usufructuaryId" IS NOT NULL AND "bareOwnerId" IS NOT NULL
        AND "usufructuaryId" <> "bareOwnerId")
);
ALTER TABLE "CompanyHolding" ADD CONSTRAINT "CompanyHolding_parts_check" CHECK ("parts" > 0);
ALTER TABLE "Company" ADD CONSTRAINT "Company_discountPct_check" CHECK ("discountPct" IS NULL OR ("discountPct" >= 0 AND "discountPct" < 1));
