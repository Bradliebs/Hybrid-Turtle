import { describe, expect, it } from 'vitest';
import { extractScoreBreakdown } from './score-tracker';
import type { ScoredTicker } from './dual-score';

function makeScoredTicker(overrides?: Partial<ScoredTicker>): ScoredTicker {
  return {
    ticker: 'AAPL',
    name: 'Apple',
    sleeve: 'CORE',
    status: 'READY',
    close: 180,
    atr_14: 3.5,
    atr_pct: 1.94,
    adx_14: 35,
    plus_di: 28,
    minus_di: 12,
    vol_ratio: 1.8,
    market_regime: 'BULLISH',
    market_regime_stable: true,
    distance_to_20d_high_pct: 1.2,
    entry_trigger: 182,
    stop_level: 176.75,
    chasing_20_last5: false,
    chasing_55_last5: false,
    atr_spiking: false,
    atr_collapsing: false,
    rs_vs_benchmark_pct: 8.5,
    // BQS components
    bqs_trend: 12.5,
    bqs_direction: 6.4,
    bqs_volatility: 15,
    bqs_proximity: 9.0,
    bqs_tailwind: 15,
    bqs_rs: 10.13,
    bqs_vol_bonus: 2.5,
    bqs_weekly_adx: 10,
    bqs_bis: 8,
    bqs_hurst: 5,
    BQS: 93.53,
    // FWS components
    fws_volume: 0,
    fws_extension: 0,
    fws_marginal_trend: 0,
    fws_vol_shock: 0,
    fws_regime_instability: 0,
    FWS: 0,
    // Penalties
    EarningsPenalty: 0,
    ClusterPenalty: 0,
    SuperClusterPenalty: 0,
    // NCS
    BaseNCS: 100,
    NCS: 100,
    di_spread: 16,
    ActionNote: 'Auto-Yes',
    ...overrides,
  };
}

describe('score-tracker', () => {
  describe('extractScoreBreakdown', () => {
    it('extracts all BQS components', () => {
      const scored = makeScoredTicker();
      const result = extractScoreBreakdown(scored, 'snap_001', 'BULLISH');

      expect(result.ticker).toBe('AAPL');
      expect(result.snapshotId).toBe('snap_001');
      expect(result.regime).toBe('BULLISH');
      expect(result.bqsTrend).toBe(12.5);
      expect(result.bqsDirection).toBe(6.4);
      expect(result.bqsVolatility).toBe(15);
      expect(result.bqsProximity).toBe(9.0);
      expect(result.bqsTailwind).toBe(15);
      expect(result.bqsRs).toBe(10.13);
      expect(result.bqsVolBonus).toBe(2.5);
      expect(result.bqsWeeklyAdx).toBe(10);
      expect(result.bqsBis).toBe(8);
      expect(result.bqsHurst).toBe(5);
      expect(result.bqsTotal).toBe(93.53);
    });

    it('extracts all FWS components', () => {
      const scored = makeScoredTicker({
        fws_volume: 15,
        fws_extension: 25,
        fws_marginal_trend: 7,
        fws_vol_shock: 0,
        fws_regime_instability: 10,
        FWS: 57,
      });
      const result = extractScoreBreakdown(scored, 'snap_002', 'SIDEWAYS');

      expect(result.fwsVolume).toBe(15);
      expect(result.fwsExtension).toBe(25);
      expect(result.fwsMarginalTrend).toBe(7);
      expect(result.fwsVolShock).toBe(0);
      expect(result.fwsRegimeInstability).toBe(10);
      expect(result.fwsTotal).toBe(57);
    });

    it('extracts penalties and NCS', () => {
      const scored = makeScoredTicker({
        EarningsPenalty: 15,
        ClusterPenalty: 8,
        SuperClusterPenalty: 0,
        BaseNCS: 75,
        NCS: 52,
      });
      const result = extractScoreBreakdown(scored, 'snap_003', 'BULLISH');

      expect(result.penaltyEarnings).toBe(15);
      expect(result.penaltyCluster).toBe(8);
      expect(result.penaltySuperCluster).toBe(0);
      expect(result.baseNcs).toBe(75);
      expect(result.ncsTotal).toBe(52);
    });

    it('preserves actionNote', () => {
      const scored = makeScoredTicker({ ActionNote: 'Auto-No (fragile)' });
      const result = extractScoreBreakdown(scored, 'snap_004', 'BEARISH');
      expect(result.actionNote).toBe('Auto-No (fragile)');
    });
  });
});
