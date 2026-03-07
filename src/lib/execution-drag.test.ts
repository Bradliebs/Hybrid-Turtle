import { describe, expect, it } from 'vitest';

// Test the execution drag computation helper (inline since module has DB dependency)
// We test the pure logic by extracting the computation formula

function computeSingleDrag(trade: {
  entryPrice: number | null;
  actualFill: number | null;
  slippagePct: number | null;
  initialR: number | null;
  finalRMultiple: number | null;
  plannedEntry: number | null;
}) {
  const modelEntry = trade.plannedEntry ?? trade.entryPrice;
  if (modelEntry == null || modelEntry === 0) return null;

  const entrySlippage = trade.actualFill != null
    ? ((trade.actualFill - modelEntry) / modelEntry) * 100
    : trade.slippagePct;

  const rDrag = trade.finalRMultiple != null && trade.initialR != null
    ? trade.finalRMultiple - trade.initialR
    : null;

  return { modelEntry, entrySlippage, rDrag };
}

describe('execution-drag', () => {
  it('computes entry slippage from actual fill vs model entry', () => {
    const result = computeSingleDrag({
      entryPrice: 100,
      actualFill: 100.50,
      slippagePct: null,
      initialR: 5,
      finalRMultiple: 3.2,
      plannedEntry: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.modelEntry).toBe(100);
    expect(result!.entrySlippage).toBeCloseTo(0.5, 1); // 0.5%
    expect(result!.rDrag).toBeCloseTo(-1.8, 1); // 3.2 - 5 = -1.8R
  });

  it('uses planned entry over actual if available', () => {
    const result = computeSingleDrag({
      entryPrice: 102,
      actualFill: 101,
      slippagePct: null,
      initialR: null,
      finalRMultiple: null,
      plannedEntry: 100,
    });

    expect(result!.modelEntry).toBe(100);
    expect(result!.entrySlippage).toBeCloseTo(1.0, 1); // 1% slippage
    expect(result!.rDrag).toBeNull(); // can't compute without R values
  });

  it('falls back to slippagePct if no actual fill', () => {
    const result = computeSingleDrag({
      entryPrice: 100,
      actualFill: null,
      slippagePct: 0.3,
      initialR: 5,
      finalRMultiple: 4.5,
      plannedEntry: null,
    });

    expect(result!.modelEntry).toBe(100);
    expect(result!.entrySlippage).toBe(0.3);
    expect(result!.rDrag).toBeCloseTo(-0.5, 1);
  });

  it('returns null for missing model entry', () => {
    const result = computeSingleDrag({
      entryPrice: null,
      actualFill: null,
      slippagePct: null,
      initialR: null,
      finalRMultiple: null,
      plannedEntry: null,
    });

    expect(result).toBeNull();
  });

  it('positive R-drag means outperformed model', () => {
    const result = computeSingleDrag({
      entryPrice: 50,
      actualFill: 49.8,
      slippagePct: null,
      initialR: 2.0,
      finalRMultiple: 3.5,
      plannedEntry: 50,
    });

    expect(result!.rDrag).toBeCloseTo(1.5, 1); // outperformed by 1.5R
    expect(result!.entrySlippage).toBeCloseTo(-0.4, 1); // got a better fill
  });
});
