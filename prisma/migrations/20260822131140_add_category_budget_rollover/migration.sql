-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "budgetRolloverEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "budgetRolloverEnabledAt" TIMESTAMP(3);
