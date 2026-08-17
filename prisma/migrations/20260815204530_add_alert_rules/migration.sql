-- CreateEnum
CREATE TYPE "AlertRuleKind" AS ENUM ('ACCOUNT_BALANCE', 'BUDGET_OVERRUN');

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "kind" "AlertRuleKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "accountId" TEXT,
    "balanceThresholdCents" BIGINT,
    "balanceLastAbove" BOOLEAN,
    "categoryId" TEXT,
    "budgetOverrunLastFiredPeriod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertRule_active_idx" ON "AlertRule"("active");

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
