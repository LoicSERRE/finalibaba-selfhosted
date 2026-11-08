-- The instance's mail server becomes an instance setting an admin owns, and
-- each user only chooses whether their alert email goes through it.
ALTER TABLE "InstanceSettings"
  ADD COLUMN "smtpHost" TEXT,
  ADD COLUMN "smtpPort" INTEGER,
  ADD COLUMN "smtpUser" TEXT,
  ADD COLUMN "smtpPassword" TEXT,
  ADD COLUMN "smtpFrom" TEXT;

ALTER TABLE "UserSettings" ADD COLUMN "useInstanceMail" BOOLEAN NOT NULL DEFAULT false;

-- Until now the `mail` service was a preset each user filled into their own
-- settings. An admin who did so has, in effect, already set the instance's
-- server: carry their settings over (the earliest such admin).
INSERT INTO "InstanceSettings" ("id", "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "smtpFrom")
SELECT 'singleton', s."smtpHost", s."smtpPort", s."smtpUser", s."smtpPassword", s."smtpFrom"
FROM "UserSettings" s
JOIN "User" u ON u."id" = s."userId"
WHERE u."role" = 'ADMIN' AND s."smtpHost" = 'mail' AND s."smtpPort" IS NOT NULL AND s."smtpFrom" IS NOT NULL
ORDER BY u."createdAt"
LIMIT 1
ON CONFLICT ("id") DO UPDATE SET
  "smtpHost" = EXCLUDED."smtpHost",
  "smtpPort" = EXCLUDED."smtpPort",
  "smtpUser" = EXCLUDED."smtpUser",
  "smtpPassword" = EXCLUDED."smtpPassword",
  "smtpFrom" = EXCLUDED."smtpFrom";

-- Everyone who used that preset, admin or member, now goes through the
-- instance's server and keeps receiving their alerts.
UPDATE "UserSettings"
SET "useInstanceMail" = true,
    "smtpHost" = NULL, "smtpPort" = NULL, "smtpUser" = NULL, "smtpPassword" = NULL, "smtpFrom" = NULL
WHERE "smtpHost" = 'mail'
  AND EXISTS (SELECT 1 FROM "InstanceSettings" WHERE "id" = 'singleton' AND "smtpHost" IS NOT NULL);
