-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_institutionId_fkey";

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
