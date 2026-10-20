-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "loanEndDate" TIMESTAMP(3),
ADD COLUMN     "loanNextPaymentCents" BIGINT,
ADD COLUMN     "loanNextPaymentDate" TIMESTAMP(3);
