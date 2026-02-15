import { describe, expect, it } from 'vitest';
import { buildInitialRiskFields, computeOpenRiskGBP } from './risk-fields';

describe('risk field clarity aliases', () => {
  it('buildInitialRiskFields provides both riskGBP and initialRiskGBP with equal values', () => {
    const fields = buildInitialRiskFields(100, 95, 10);

    expect(fields).toHaveProperty('riskGBP');
    expect(fields).toHaveProperty('initialRiskGBP');
    expect(fields.riskGBP).toBe(fields.initialRiskGBP);
    expect(fields.initialRiskGBP).toBe(50);
  });

  it('computeOpenRiskGBP is clamped at >= 0', () => {
    expect(computeOpenRiskGBP(100, 95, 10)).toBe(50);
    expect(computeOpenRiskGBP(95, 100, 10)).toBe(0);
  });
});
