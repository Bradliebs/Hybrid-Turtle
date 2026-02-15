/*
  Warnings:

  - You are about to drop the column `action` on the `TradeLog` table. All the data in the column will be lost.
  - You are about to drop the column `actualPrice` on the `TradeLog` table. All the data in the column will be lost.
  - You are about to drop the column `expectedPrice` on the `TradeLog` table. All the data in the column will be lost.
  - You are about to drop the column `rMultipleAtExit` on the `TradeLog` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `TradeLog` table. All the data in the column will be lost.
  - You are about to drop the column `slippagePercent` on the `TradeLog` table. All the data in the column will be lost.
  - Added the required column `decision` to the `TradeLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tradeDate` to the `TradeLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tradeType` to the `TradeLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `TradeLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Position" ADD COLUMN "atr_at_entry" REAL;
ALTER TABLE "Position" ADD COLUMN "entry_price" REAL;
ALTER TABLE "Position" ADD COLUMN "entry_type" TEXT DEFAULT 'BREAKOUT';
ALTER TABLE "Position" ADD COLUMN "initial_R" REAL;
ALTER TABLE "Position" ADD COLUMN "initial_stop" REAL;
ALTER TABLE "Position" ADD COLUMN "profile_used" TEXT;

-- CreateTable
CREATE TABLE "TradeTag" (
    "tag" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TradeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "ticker" TEXT NOT NULL,
    "tradeDate" DATETIME NOT NULL,
    "tradeType" TEXT NOT NULL,
    "scanStatus" TEXT,
    "bqsScore" REAL,
    "fwsScore" REAL,
    "ncsScore" REAL,
    "dualScoreAction" TEXT,
    "rankScore" REAL,
    "entryPrice" REAL,
    "initialStop" REAL,
    "initialR" REAL,
    "shares" REAL,
    "positionSizeGbp" REAL,
    "atrAtEntry" REAL,
    "adxAtEntry" REAL,
    "regime" TEXT,
    "decision" TEXT NOT NULL,
    "decisionReason" TEXT,
    "hesitationLevel" INTEGER,
    "plannedEntry" REAL,
    "actualFill" REAL,
    "slippagePct" REAL,
    "fillTime" DATETIME,
    "exitPrice" REAL,
    "exitReason" TEXT,
    "finalRMultiple" REAL,
    "gainLossGbp" REAL,
    "daysHeld" INTEGER,
    "whatWentWell" TEXT,
    "whatWentWrong" TEXT,
    "lessonsLearned" TEXT,
    "wouldTakeAgain" BOOLEAN,
    "climaxDetected" BOOLEAN NOT NULL DEFAULT false,
    "whipsawBlocked" BOOLEAN NOT NULL DEFAULT false,
    "breadthRestricted" BOOLEAN NOT NULL DEFAULT false,
    "antiChaseTriggered" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeLog_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TradeLog" ("createdAt", "id", "positionId", "shares", "ticker", "userId") SELECT "createdAt", "id", "positionId", "shares", "ticker", "userId" FROM "TradeLog";
DROP TABLE "TradeLog";
ALTER TABLE "new_TradeLog" RENAME TO "TradeLog";
CREATE INDEX "TradeLog_userId_tradeDate_idx" ON "TradeLog"("userId", "tradeDate" DESC);
CREATE INDEX "TradeLog_positionId_idx" ON "TradeLog"("positionId");
CREATE INDEX "TradeLog_ticker_idx" ON "TradeLog"("ticker");
CREATE INDEX "TradeLog_decision_idx" ON "TradeLog"("decision");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
