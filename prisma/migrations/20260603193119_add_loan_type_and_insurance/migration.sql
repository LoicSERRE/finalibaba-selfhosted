-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'LOAN';

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_institutionId_fkey";

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "insuranceMonthlyCents" BIGINT,
ADD COLUMN     "loanAmountCents" BIGINT,
ADD COLUMN     "loanDeferralMonths" INTEGER,
ADD COLUMN     "loanDurationMonths" INTEGER,
ADD COLUMN     "loanStartDate" TIMESTAMP(3),
ADD COLUMN     "loanTaeg" DOUBLE PRECISION,
ALTER COLUMN "institutionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
