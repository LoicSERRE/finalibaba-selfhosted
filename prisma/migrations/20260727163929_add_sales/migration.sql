-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "proceedsCents" BIGINT NOT NULL,
    "costBasisCents" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sale_accountId_date_idx" ON "Sale"("accountId", "date");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
