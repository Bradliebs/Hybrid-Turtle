-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "riskProfile" TEXT NOT NULL DEFAULT 'BALANCED',
    "equity" REAL NOT NULL DEFAULT 10000,
    "t212ApiKey" TEXT,
    "t212ApiSecret" TEXT,
    "t212Environment" TEXT NOT NULL DEFAULT 'demo',
    "t212Connected" BOOLEAN NOT NULL DEFAULT false,
    "t212LastSync" DATETIME,
    "t212AccountId" TEXT,
    "t212Currency" TEXT,
    "t212Cash" REAL,
    "t212Invested" REAL,
    "t212UnrealisedPL" REAL,
    "t212TotalValue" REAL,
    "t212IsaApiKey" TEXT,
    "t212IsaApiSecret" TEXT,
    "t212IsaConnected" BOOLEAN NOT NULL DEFAULT false,
    "t212IsaLastSync" DATETIME,
    "t212IsaAccountId" TEXT,
    "t212IsaCurrency" TEXT,
    "t212IsaCash" REAL,
    "t212IsaInvested" REAL,
    "t212IsaUnrealisedPL" REAL,
    "t212IsaTotalValue" REAL,
    "marketDataProvider" TEXT NOT NULL DEFAULT 'yahoo',
    "eodhApiKey" TEXT,
    "gapGuardMode" TEXT NOT NULL DEFAULT 'ALL',
    "gapGuardWeekendATR" REAL NOT NULL DEFAULT 0.75,
    "gapGuardWeekendPct" REAL NOT NULL DEFAULT 3.0,
    "gapGuardDailyATR" REAL NOT NULL DEFAULT 1.0,
    "gapGuardDailyPct" REAL NOT NULL DEFAULT 4.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "eodhApiKey", "equity", "id", "marketDataProvider", "name", "password", "riskProfile", "t212AccountId", "t212ApiKey", "t212ApiSecret", "t212Cash", "t212Connected", "t212Currency", "t212Environment", "t212Invested", "t212IsaAccountId", "t212IsaApiKey", "t212IsaApiSecret", "t212IsaCash", "t212IsaConnected", "t212IsaCurrency", "t212IsaInvested", "t212IsaLastSync", "t212IsaTotalValue", "t212IsaUnrealisedPL", "t212LastSync", "t212TotalValue", "t212UnrealisedPL", "updatedAt") SELECT "createdAt", "email", "eodhApiKey", "equity", "id", "marketDataProvider", "name", "password", "riskProfile", "t212AccountId", "t212ApiKey", "t212ApiSecret", "t212Cash", "t212Connected", "t212Currency", "t212Environment", "t212Invested", "t212IsaAccountId", "t212IsaApiKey", "t212IsaApiSecret", "t212IsaCash", "t212IsaConnected", "t212IsaCurrency", "t212IsaInvested", "t212IsaLastSync", "t212IsaTotalValue", "t212IsaUnrealisedPL", "t212LastSync", "t212TotalValue", "t212UnrealisedPL", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
