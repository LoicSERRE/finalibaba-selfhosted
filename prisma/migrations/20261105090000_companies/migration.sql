-- CreateEnum
CREATE TYPE "CompanyKind" AS ENUM ('SCI', 'HOLDING', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanyTaxRegime" AS ENUM ('IR', 'IS');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CompanyKind" NOT NULL DEFAULT 'SCI',
    "taxRegime" "CompanyTaxRegime" NOT NULL DEFAULT 'IR',
    "totalParts" INTEGER NOT NULL,
    "managerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAssociate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "linkAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAssociate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyHolding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parts" INTEGER NOT NULL,
    "fullOwnerId" TEXT NOT NULL,

    CONSTRAINT "CompanyHolding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_managerUserId_idx" ON "Company"("managerUserId");

-- CreateIndex
CREATE INDEX "CompanyAssociate_userId_idx" ON "CompanyAssociate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAssociate_companyId_userId_key" ON "CompanyAssociate"("companyId", "userId");

-- CreateIndex
CREATE INDEX "CompanyHolding_companyId_idx" ON "CompanyHolding"("companyId");

-- CreateIndex
CREATE INDEX "Account_companyId_idx" ON "Account"("companyId");

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAssociate" ADD CONSTRAINT "CompanyAssociate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAssociate" ADD CONSTRAINT "CompanyAssociate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHolding" ADD CONSTRAINT "CompanyHolding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHolding" ADD CONSTRAINT "CompanyHolding_fullOwnerId_fkey" FOREIGN KEY ("fullOwnerId") REFERENCES "CompanyAssociate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

