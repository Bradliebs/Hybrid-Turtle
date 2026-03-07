-- Add prediction engine toggle settings to User model.
ALTER TABLE "User" ADD COLUMN "showIntradayNCS" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "applyKellyMultiplier" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "rlShadowMode" BOOLEAN NOT NULL DEFAULT true;
