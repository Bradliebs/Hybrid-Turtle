import { afterEach, describe, expect, it } from 'vitest';
import { calculateAdaptiveBuffer } from './adaptive-atr-buffer';

const originalFlag = process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER;

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER;
  } else {
    process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER = originalFlag;
  }
});

describe('adaptive-atr-buffer feature flag: USE_PRIOR_20D_HIGH_FOR_TRIGGER', () => {
  it('uses prior-window high and produces a lower/stable trigger when enabled', () => {
    process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER = 'false';
    const currentWindowTrigger = calculateAdaptiveBuffer('TEST', 110, 8, 4, 100).adjustedEntryTrigger;

    process.env.USE_PRIOR_20D_HIGH_FOR_TRIGGER = 'true';
    const priorWindowTrigger = calculateAdaptiveBuffer('TEST', 110, 8, 4, 100).adjustedEntryTrigger;

    expect(currentWindowTrigger).toBeCloseTo(111, 8);
    expect(priorWindowTrigger).toBeCloseTo(101, 8);
    expect(priorWindowTrigger).toBeLessThan(currentWindowTrigger);
  });
});
