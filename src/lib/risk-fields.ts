export function buildInitialRiskFields(
  entryPriceGBP: number,
  stopGBP: number,
  shares: number
): {
  initialRiskGBP: number;
  riskGBP: number;
} {
  const initialRiskGBP = Math.max(0, (entryPriceGBP - stopGBP) * shares);
  return {
    initialRiskGBP,
    riskGBP: initialRiskGBP,
  };
}

export function computeOpenRiskGBP(
  currentPriceGbp: number,
  currentStopGbp: number,
  shares: number
): number {
  return Math.max(0, (currentPriceGbp - currentStopGbp) * shares);
}
