-- Add Woob credentials to Institution for generic bank sync
ALTER TABLE "Institution" ADD COLUMN "woobModule" TEXT;
ALTER TABLE "Institution" ADD COLUMN "woobLogin" TEXT;
ALTER TABLE "Institution" ADD COLUMN "woobPassword" TEXT;
