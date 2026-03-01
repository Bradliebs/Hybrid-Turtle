import { describe, expect, it } from 'vitest';
import {
  detectBreakoutFailures,
  BREAKOUT_FAILURE_CONFIG,
  type BreakoutFailureInput,
} from './breakout-failure-detector';

// ── Helpers ────────────────────────────────────────────────────────

/** Build a valid input with sensible defaults — override per test */
function makeInput(overrides: Partial<BreakoutFailureInput> = {}): BreakoutFailureInput {
  return {
    id: 'pos-1',
    ticker: 'AME',
    entryPrice: 240.00,
    entryDate: daysAgo(3),           // 3 days held — inside the 5-day window
    entryTrigger: 240.91,            // Donchian trigger above entry fill
    initialRisk: 10.00,              // risk per share
    currentPrice: 238.40,            // below trigger → failure candidate
    shares: 10,
    currency: 'USD',
    alreadyFlagged: false,
    ...overrides,
  };
}

/** Return a Date that is `n` days before now */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Config Sanity ──────────────────────────────────────────────────

describe('BREAKOUT_FAILURE_CONFIG', () => {
  it('has maxDaysHeld = 5', () => {
    expect(BREAKOUT_FAILURE_CONFIG.maxDaysHeld).toBe(5);
  });

  it('has maxRMultiple = 0.5', () => {
    expect(BREAKOUT_FAILURE_CONFIG.maxRMultiple).toBe(0.5);
  });
});

// ── Core Detection ─────────────────────────────────────────────────

describe('detectBreakoutFailures', () => {
  it('returns empty array for empty input', () => {
    expect(detectBreakoutFailures([])).toEqual([]);
  });

  it('detects a classic breakout failure (price < trigger, daysHeld ≤ 5, R < 0.5)', () => {
    const input = makeInput();
    const results = detectBreakoutFailures([input]);
    expect(results).toHaveLength(1);
    expect(results[0].positionId).toBe('pos-1');
    expect(results[0].ticker).toBe('AME');
    expect(results[0].daysHeld).toBe(3);
    expect(results[0].entryTrigger).toBe(240.91);
    expect(results[0].currentPrice).toBe(238.40);
  });

  it('computes estimated loss correctly', () => {
    const input = makeInput({
      entryPrice: 240.00,
      currentPrice: 238.40,
      shares: 10,
    });
    const results = detectBreakoutFailures([input]);
    // (238.40 - 240.00) * 10 = -16.00
    expect(results[0].estimatedLoss).toBeCloseTo(-16.00, 2);
  });

  it('computes R-multiple correctly', () => {
    const input = makeInput({
      entryPrice: 240.00,
      currentPrice: 237.00,
      initialRisk: 10.00,
    });
    const results = detectBreakoutFailures([input]);
    // (237 - 240) / 10 = -0.3
    expect(results[0].rMultiple).toBeCloseTo(-0.3, 2);
  });

  // ── Condition: daysHeld ───────────────────────────────────────

  describe('daysHeld window', () => {
    it('detects at day 0 (same-day entry)', () => {
      const input = makeInput({ entryDate: daysAgo(0) });
      expect(detectBreakoutFailures([input])).toHaveLength(1);
    });

    it('detects at day 1', () => {
      const input = makeInput({ entryDate: daysAgo(1) });
      expect(detectBreakoutFailures([input])).toHaveLength(1);
    });

    it('detects at day 5 (boundary — included)', () => {
      const input = makeInput({ entryDate: daysAgo(5) });
      expect(detectBreakoutFailures([input])).toHaveLength(1);
    });

    it('skips at day 6 (outside window)', () => {
      const input = makeInput({ entryDate: daysAgo(6) });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('skips at day 30 (well outside window)', () => {
      const input = makeInput({ entryDate: daysAgo(30) });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });
  });

  // ── Condition: currentPrice vs entryTrigger ──────────────────

  describe('price vs trigger threshold', () => {
    it('detects when price is below trigger', () => {
      const input = makeInput({ currentPrice: 239.00, entryTrigger: 240.91 });
      expect(detectBreakoutFailures([input])).toHaveLength(1);
    });

    it('skips when price equals trigger exactly', () => {
      const input = makeInput({ currentPrice: 240.91, entryTrigger: 240.91 });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('skips when price is above trigger', () => {
      const input = makeInput({ currentPrice: 245.00, entryTrigger: 240.91 });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });
  });

  // ── Condition: R-multiple threshold ──────────────────────────

  describe('R-multiple threshold', () => {
    it('detects when R < 0.5 (losing trade, still below trigger)', () => {
      // R = (235 - 240) / 10 = -0.5, price 235 < trigger 240.91
      const input = makeInput({ currentPrice: 235.00, entryPrice: 240.00, initialRisk: 10 });
      expect(detectBreakoutFailures([input])).toHaveLength(1);
    });

    it('skips when R >= 0.5 (trade is working — healthy pullback)', () => {
      // R = (248 - 240) / 10 = 0.8, but price 248 > trigger 240.91 → also skipped by price check
      // Use a case where price < trigger but R >= 0.5 due to low initialRisk
      // e.g. entry 240, currentPrice 240.50, trigger 241, initialRisk 0.5 → R = (240.50-240)/0.5 = 1.0
      const input = makeInput({
        entryPrice: 240.00,
        currentPrice: 240.50,
        entryTrigger: 241.00,
        initialRisk: 0.5,
      });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('skips when R exactly = 0.5', () => {
      // R = (245 - 240) / 10 = 0.5 → exactly at threshold → skipped
      // But price 245 > trigger 240.91, so also skipped by price check
      // Construct: entry 240, trigger 246, price 245, risk 10 → R=0.5, price < trigger
      const input = makeInput({
        entryPrice: 240.00,
        currentPrice: 245.00,
        entryTrigger: 246.00,
        initialRisk: 10,
      });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });
  });

  // ── Already flagged ──────────────────────────────────────────

  describe('alreadyFlagged guard', () => {
    it('skips positions already flagged (once flagged, permanent)', () => {
      const input = makeInput({ alreadyFlagged: true });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('detects same position when not yet flagged', () => {
      const input = makeInput({ alreadyFlagged: false });
      expect(detectBreakoutFailures([input])).toHaveLength(1);
    });
  });

  // ── Fallback: entryTrigger null → uses entryPrice ───────────

  describe('entryTrigger fallback', () => {
    it('uses entryPrice when entryTrigger is null (legacy positions)', () => {
      const input = makeInput({
        entryTrigger: null,
        entryPrice: 240.00,
        currentPrice: 238.00, // below entryPrice → triggers
      });
      const results = detectBreakoutFailures([input]);
      expect(results).toHaveLength(1);
      // Trigger should be the entryPrice fallback
      expect(results[0].entryTrigger).toBe(240.00);
    });

    it('uses entryPrice when entryTrigger is 0 (invalid data)', () => {
      const input = makeInput({
        entryTrigger: 0,
        entryPrice: 240.00,
        currentPrice: 238.00,
      });
      const results = detectBreakoutFailures([input]);
      expect(results).toHaveLength(1);
      expect(results[0].entryTrigger).toBe(240.00);
    });

    it('no false positive when price above entryPrice fallback', () => {
      const input = makeInput({
        entryTrigger: null,
        entryPrice: 240.00,
        currentPrice: 241.00, // above entryPrice → no failure
      });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });
  });

  // ── Invalid / edge-case data guards ──────────────────────────

  describe('data guards', () => {
    it('skips when currentPrice is 0', () => {
      const input = makeInput({ currentPrice: 0 });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('skips when currentPrice is negative', () => {
      const input = makeInput({ currentPrice: -1 });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('skips when entryPrice is 0', () => {
      const input = makeInput({ entryPrice: 0 });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('skips when entryPrice is negative', () => {
      const input = makeInput({ entryPrice: -5 });
      expect(detectBreakoutFailures([input])).toHaveLength(0);
    });

    it('handles initialRisk of 0 gracefully (R defaults to 0)', () => {
      const input = makeInput({ initialRisk: 0 });
      // R = 0, which is < 0.5 → still triggers if other conditions met
      expect(detectBreakoutFailures([input])).toHaveLength(1);
    });
  });

  // ── Multi-position batch ─────────────────────────────────────

  describe('batch detection', () => {
    it('returns only qualifying positions from a mixed batch', () => {
      const positions = [
        makeInput({ id: 'fail-1', ticker: 'AME', currentPrice: 238.40 }),  // qualifies
        makeInput({ id: 'ok-2', ticker: 'AAPL', currentPrice: 250.00 }),   // above trigger → skip
        makeInput({ id: 'old-3', ticker: 'MSFT', entryDate: daysAgo(10) }), // too old → skip
        makeInput({ id: 'flagged-4', ticker: 'NVDA', alreadyFlagged: true }), // already flagged → skip
        makeInput({ id: 'fail-5', ticker: 'DELL', currentPrice: 235.00 }),  // qualifies
      ];
      const results = detectBreakoutFailures(positions);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.positionId)).toEqual(['fail-1', 'fail-5']);
    });

    it('returns results in input order', () => {
      const positions = [
        makeInput({ id: 'a', ticker: 'ZZZ', currentPrice: 230.00 }),
        makeInput({ id: 'b', ticker: 'AAA', currentPrice: 230.00 }),
      ];
      const results = detectBreakoutFailures(positions);
      expect(results[0].positionId).toBe('a');
      expect(results[1].positionId).toBe('b');
    });
  });

  // ── Reason string ────────────────────────────────────────────

  describe('reason output', () => {
    it('includes trigger price and days held in reason', () => {
      const input = makeInput({ entryDate: daysAgo(3), entryTrigger: 240.91 });
      const results = detectBreakoutFailures([input]);
      expect(results[0].reason).toContain('240.91');
      expect(results[0].reason).toContain('3 days');
    });

    it('uses singular "day" for daysHeld = 1', () => {
      const input = makeInput({ entryDate: daysAgo(1) });
      const results = detectBreakoutFailures([input]);
      expect(results[0].reason).toMatch(/1 day[^s]/);
    });
  });

  // ── Currency passthrough ─────────────────────────────────────

  describe('currency passthrough', () => {
    it('passes through USD currency', () => {
      const results = detectBreakoutFailures([makeInput({ currency: 'USD' })]);
      expect(results[0].currency).toBe('USD');
    });

    it('passes through GBX currency (UK pence)', () => {
      const results = detectBreakoutFailures([makeInput({ currency: 'GBX' })]);
      expect(results[0].currency).toBe('GBX');
    });

    it('passes through EUR currency', () => {
      const results = detectBreakoutFailures([makeInput({ currency: 'EUR' })]);
      expect(results[0].currency).toBe('EUR');
    });
  });
});
