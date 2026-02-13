// ============================================================
// Module Index — Barrel Exports
// ============================================================

export { checkEarlyBird, scanEarlyBirds } from './early-bird';
export { detectLaggards } from './laggard-purge';
export { checkClimaxTop, scanClimaxSignals } from './climax-detector';
export { findSwapSuggestions } from './heatmap-swap';
export { runHeatCheck } from './heat-check';
export { scanFastFollowers } from './fast-follower';
export { calculateBreadth, checkBreadthSafety } from './breadth-safety';
export { checkWhipsawBlocks } from './whipsaw-guard';
export { checkSuperClusterCaps } from './super-cluster';
export { checkMomentumExpansion } from './momentum-expansion';
export { logTrade, getTradeLog, getSlippageSummary } from './trade-logger';
export { calculateTurnover } from './turnover-monitor';
export { generateActionCard, actionCardToMarkdown } from './weekly-action-card';
export { validateTickerData, validateUniverse } from './data-validator';
export { scanReEntrySignals } from './re-entry-logic';
export { calculateAdaptiveBuffer } from './adaptive-atr-buffer';
