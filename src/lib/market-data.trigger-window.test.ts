import { describe, expect, it } from 'vitest';
import { calculate20DayHigh, getPriorNDayHigh } from './market-data';

describe('20-day high window helpers', () => {
  it('current-window high changes while prior-window high stays stable when latest bar makes a new high', () => {
    const trailing20 = Array.from({ length: 20 }, (_, i) => ({ high: 100 - i }));

    const withLatestHigh110 = [{ high: 110 }, ...trailing20];
    const withLatestHigh105 = [{ high: 105 }, ...trailing20];

    expect(calculate20DayHigh(withLatestHigh110)).toBe(110);
    expect(calculate20DayHigh(withLatestHigh105)).toBe(105);

    expect(getPriorNDayHigh(withLatestHigh110, 20)).toBe(100);
    expect(getPriorNDayHigh(withLatestHigh105, 20)).toBe(100);
  });
});
