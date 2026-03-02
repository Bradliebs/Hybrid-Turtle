-- AlterTable: Add T212 import fields to TradeLog
ALTER TABLE "TradeLog" ADD COLUMN "t212OrderId" TEXT;
ALTER TABLE "TradeLog" ADD COLUMN "t212Ticker" TEXT;
ALTER TABLE "TradeLog" ADD COLUMN "fillPrice" REAL;
ALTER TABLE "TradeLog" ADD COLUMN "fillQuantity" REAL;
ALTER TABLE "TradeLog" ADD COLUMN "fillTimestamp" DATETIME;
ALTER TABLE "TradeLog" ADD COLUMN "fxRateAtFill" REAL;
ALTER TABLE "TradeLog" ADD COLUMN "netValueGbp" REAL;
ALTER TABLE "TradeLog" ADD COLUMN "realisedPnlT212" REAL;
ALTER TABLE "TradeLog" ADD COLUMN "initiatedFrom" TEXT;
ALTER TABLE "TradeLog" ADD COLUMN "importedFromT212" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TradeLog" ADD COLUMN "importedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "TradeLog_t212OrderId_key" ON "TradeLog"("t212OrderId");
