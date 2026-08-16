-- CreateTable
CREATE TABLE "ReviewQRCode" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fgColor" TEXT NOT NULL DEFAULT '#000000',
    "bgColor" TEXT NOT NULL DEFAULT '#ffffff',
    "status" TEXT NOT NULL DEFAULT 'active',
    "scans" INTEGER NOT NULL DEFAULT 0,
    "reviews" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewQRCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewQRCode_slug_key" ON "ReviewQRCode"("slug");

-- CreateIndex
CREATE INDEX "ReviewQRCode_businessId_idx" ON "ReviewQRCode"("businessId");

-- AddForeignKey
ALTER TABLE "ReviewQRCode" ADD CONSTRAINT "ReviewQRCode_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable Business: review QR settings
ALTER TABLE "Business" ADD COLUMN "reviewQrAutoReplyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Business" ADD COLUMN "reviewQrNegativeRedirectUrl" TEXT;