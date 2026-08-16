-- AlterTable ReviewQRCode: pre-written (suggested) review templates shown on
-- the scan interstitial so customers can copy-paste a ready review on Google.
ALTER TABLE "ReviewQRCode" ADD COLUMN "suggestedReviews" TEXT[] DEFAULT ARRAY[]::TEXT[];