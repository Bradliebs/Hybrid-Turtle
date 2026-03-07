/**
 * DEPENDENCIES
 * Consumed by: /api/plan/allocation/route.ts, plan page
 * Consumes: position-sizer.ts, risk-gates.ts, prisma.ts, @/types
 * Risk-sensitive: YES — uses position sizer and risk gates (read-only, no orders)
 * Last modified: 2026-03-06
 * Notes: Produces a portfolio-level capital allocation ranking from scored
 *        candidates. Respects all 6 risk gates and cascading budget.
 *        Output is advisory — does not execute trades.
 */
import type { Sleeve, RiskProfileType, AllocationEntry } from '@/types';
import { RISK_PROFILES } from '@/types';
import { calculatePositionSize } from './position-sizer';
import { validateRiskGates } from './risk-gates';
import prisma from './prisma';

interface CandidateInput {
  ticker: string;
  name: string;
  sleeve: Sleeve;
  sector: string;
  cluster: string;
  entryTrigger: number;
  stopPrice: number;
  ncs: number;
  fws: number;
  bqs: number;
  fxToGbp: number;
  currency?: string;
}

interface ExistingPosition {
  id: string;
  ticker: string;
  sleeve: Sleeve;
  sector: string;
  cluster: string;
  value: number;
  riskDollars: number;
  shares: number;
  entryPrice: number;
  currentStop: number;
  currentPrice: number;
}

/**
 * Rank candidates for capital allocation, respecting cascading risk gate budget.
 * Simulates adding positions one by one, checking gates at each step.
 */
export async function rankForCapitalAllocation(
  candidates: CandidateInput[],
  equity: number,
  riskProfile: RiskProfileType,
  userId: string
): Promise<AllocationEntry[]> {
  const profile = RISK_PROFILES[riskProfile];
  const maxRiskBudget = profile.maxOpenRisk;

  // Fetch existing positions for gate simulation
  const existingPositions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: true },
  });

  const positionsForGates: ExistingPosition[] = existingPositions.map((p) => ({
    id: p.id,
    ticker: p.stock.ticker,
    sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
    sector: p.stock.sector || 'Unknown',
    cluster: p.stock.cluster || 'General',
    value: p.entryPrice * p.shares,
    riskDollars: Math.max(0, (p.entryPrice - p.currentStop) * p.shares),
    shares: p.shares,
    entryPrice: p.entryPrice,
    currentStop: p.currentStop,
    currentPrice: p.entryPrice, // approximation; replaced by live price in scan
  }));

  // Sort candidates by NCS descending (best first)
  const sorted = [...candidates].sort((a, b) => b.ncs - a.ncs);

  const entries: AllocationEntry[] = [];
  // Track cumulative simulated positions for cascading gates
  const simulatedPositions = [...positionsForGates];
  let cumulativeRiskPct = positionsForGates.reduce(
    (sum, p) => sum + (p.riskDollars / equity) * 100,
    0
  );

  for (const candidate of sorted) {
    // Size the position
    let sizing;
    try {
      sizing = calculatePositionSize({
        equity,
        riskProfile,
        entryPrice: candidate.entryTrigger,
        stopPrice: candidate.stopPrice,
        sleeve: candidate.sleeve,
        fxToGbp: candidate.fxToGbp,
        allowFractional: true,
      });
    } catch {
      continue; // sizing failed (e.g. stop >= entry)
    }

    if (sizing.shares <= 0) continue;

    // Check risk gates with simulated portfolio
    const gateResults = validateRiskGates(
      {
        sleeve: candidate.sleeve,
        sector: candidate.sector,
        cluster: candidate.cluster,
        value: sizing.totalCost,
        riskDollars: sizing.riskDollars,
      },
      simulatedPositions,
      equity,
      riskProfile
    );

    const allGatesPassed = gateResults.every((g) => g.passed);
    const newRiskPct = (sizing.riskDollars / equity) * 100;
    cumulativeRiskPct += newRiskPct;

    // Determine tier
    const tier = allGatesPassed && cumulativeRiskPct <= maxRiskBudget
      ? 'RECOMMENDED'
      : 'IF_BUDGET_ALLOWS';

    entries.push({
      rank: entries.length + 1,
      ticker: candidate.ticker,
      name: candidate.name,
      sleeve: candidate.sleeve,
      ncs: candidate.ncs,
      fws: candidate.fws,
      bqs: candidate.bqs,
      entryTrigger: candidate.entryTrigger,
      stopPrice: candidate.stopPrice,
      shares: sizing.shares,
      positionSizeGbp: sizing.totalCost,
      riskGbp: sizing.riskDollars,
      riskPct: sizing.riskPercent,
      tier,
      cumulativeRiskPct: Math.round(cumulativeRiskPct * 100) / 100,
      riskGatesPassed: allGatesPassed,
    });

    // If gates passed, add to simulated positions for cascading
    if (allGatesPassed) {
      simulatedPositions.push({
        id: `sim_${candidate.ticker}`,
        ticker: candidate.ticker,
        sleeve: candidate.sleeve,
        sector: candidate.sector,
        cluster: candidate.cluster,
        value: sizing.totalCost,
        riskDollars: sizing.riskDollars,
        shares: sizing.shares,
        entryPrice: candidate.entryTrigger,
        currentStop: candidate.stopPrice,
        currentPrice: candidate.entryTrigger,
      });
    }
  }

  return entries;
}
