-- Per-module Woob configuration beyond login/password (issue #135), encrypted
-- at rest by the app like woobPassword.
ALTER TABLE "Institution" ADD COLUMN "woobConfig" TEXT;
