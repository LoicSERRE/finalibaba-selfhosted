-- An account type the user chose, which the sync no longer overrides (v2.22).
ALTER TABLE "Account" ADD COLUMN "typeSetByUser" BOOLEAN NOT NULL DEFAULT false;

-- Bank accounts the user asked the sync never to import again (v2.22).
CREATE TABLE "IgnoredSyncAccount" (
    "institutionId" TEXT NOT NULL,
    "nativeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgnoredSyncAccount_pkey" PRIMARY KEY ("institutionId","nativeId")
);

ALTER TABLE "IgnoredSyncAccount" ADD CONSTRAINT "IgnoredSyncAccount_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
