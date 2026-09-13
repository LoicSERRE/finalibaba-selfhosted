-- Share links, API keys and invitation tokens are looked up BY VALUE, so
-- encrypting the column alone would break every one of those lookups:
-- AES-GCM uses a random IV, the same token encrypts differently every time,
-- and no WHERE clause can match it.
--
-- The digest is what the lookup uses from now on; `token` keeps the value
-- itself, encrypted, because share links and API keys stay re-copyable in
-- Settings rather than shown once (see CLAUDE.md's "Read-only share links").
--
-- A plain SHA-256 rather than bcrypt, deliberately: these are 256 random bits
-- from randomBytes(32), not a human-chosen password, so there is no dictionary
-- to slow an attacker down against and a per-row salt would only prevent the
-- lookup this column exists for.
--
-- Nullable, so an existing instance applies this migration with no downtime
-- and the backfill fills it in afterwards. Every row written from v2.10.6 on
-- has one.
ALTER TABLE "ApiKey" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "ShareLink" ADD COLUMN "tokenHash" TEXT;

CREATE UNIQUE INDEX "ApiKey_tokenHash_key" ON "ApiKey"("tokenHash");
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");
