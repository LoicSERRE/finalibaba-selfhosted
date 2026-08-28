-- CreateEnum
CREATE TYPE "TransactionAlertDirection" AS ENUM ('DEBIT', 'CREDIT');

-- AlterEnum
ALTER TYPE "AlertRuleKind" ADD VALUE 'NEW_TRANSACTION';

-- AlterTable
ALTER TABLE "AlertRule" ADD COLUMN     "lastNotifiedTransactionAt" TIMESTAMP(3),
ADD COLUMN     "transactionDirection" "TransactionAlertDirection";
