-- CreateTable
CREATE TABLE "InstanceConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "baseCurrency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceConfig_pkey" PRIMARY KEY ("id")
);
