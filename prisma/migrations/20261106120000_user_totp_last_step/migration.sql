-- A TOTP code is accepted once: the step of the last one accepted.
ALTER TABLE "User" ADD COLUMN "totpLastStep" INTEGER;
