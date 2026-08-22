-- CreateTable
CREATE TABLE "TransactionSplit" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "categoryId" TEXT,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionSplit_categoryId_idx" ON "TransactionSplit"("categoryId");

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
