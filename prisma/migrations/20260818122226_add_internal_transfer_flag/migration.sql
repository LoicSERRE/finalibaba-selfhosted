-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "isInternalTransfer" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Transaction_isInternalTransfer_idx" ON "Transaction"("isInternalTransfer");
