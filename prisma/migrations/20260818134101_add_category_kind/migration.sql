-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('EXPENSE', 'INCOME');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "kind" "CategoryKind" NOT NULL DEFAULT 'EXPENSE';

-- DataMigration: any pre-existing "Revenus" category (created by the
-- automatic categorization dictionary before this migration existed) is
-- retroactively marked INCOME - it was always meant to be one, this is
-- the first release where the distinction exists to set.
UPDATE "Category" SET "kind" = 'INCOME' WHERE "name" = 'Revenus';
