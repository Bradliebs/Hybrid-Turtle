-- Optimized indexes for analytics query patterns
-- Based on query audit of candidate-outcome, filter-attribution, score-breakdown services

-- CandidateOutcome: enrichment pipeline (WHERE enrichedAt=null ORDER scanDate ASC)
CREATE INDEX IF NOT EXISTS "CandidateOutcome_enrichedAt_scanDate_idx" ON "CandidateOutcome"("enrichedAt", "scanDate");

-- CandidateOutcome: execution audit join (WHERE ticker IN (...) AND tradePlaced=true)
CREATE INDEX IF NOT EXISTS "CandidateOutcome_ticker_tradePlaced_idx" ON "CandidateOutcome"("ticker", "tradePlaced");

-- CandidateOutcome: trade link backfill (WHERE ticker + scanDate ±2 days)
CREATE INDEX IF NOT EXISTS "CandidateOutcome_ticker_scanDate_idx" ON "CandidateOutcome"("ticker", "scanDate");

-- CandidateOutcome: scorecard/validation filtering by sleeve
CREATE INDEX IF NOT EXISTS "CandidateOutcome_sleeve_idx" ON "CandidateOutcome"("sleeve");

-- FilterAttribution: outcome backfill (WHERE ticker + scanDate ±2 days + tradeLogId IS NULL)
CREATE INDEX IF NOT EXISTS "FilterAttribution_ticker_scanDate_idx" ON "FilterAttribution"("ticker", "scanDate");

-- ScoreBreakdown: outcome backfill + score-backfill join (WHERE ticker + scoredAt ±2 days)
CREATE INDEX IF NOT EXISTS "ScoreBreakdown_ticker_scoredAt_idx" ON "ScoreBreakdown"("ticker", "scoredAt");
