-- GNN Model Weights: serialised GraphSAGE parameters (~200 params as JSON).
CREATE TABLE "GNNModelWeights" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weightsJson" TEXT NOT NULL,
    "trainingLoss" REAL NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "epochs" INTEGER NOT NULL
);

CREATE INDEX "GNNModelWeights_trainedAt_idx" ON "GNNModelWeights"("trainedAt");

-- GNN Inference Log: per-ticker per-run audit trail.
CREATE TABLE "GNNInferenceLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "inferredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticker" TEXT NOT NULL,
    "gnnScore" REAL NOT NULL,
    "ncsAdjustment" REAL NOT NULL,
    "modelId" INTEGER,
    "graphNodes" INTEGER NOT NULL
);

CREATE INDEX "GNNInferenceLog_ticker_idx" ON "GNNInferenceLog"("ticker");
CREATE INDEX "GNNInferenceLog_inferredAt_idx" ON "GNNInferenceLog"("inferredAt");
