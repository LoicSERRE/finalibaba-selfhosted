-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN     "includeHoldings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "includeTransactions" BOOLEAN NOT NULL DEFAULT false;
