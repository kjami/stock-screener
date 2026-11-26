/**
 * Profile rules, locked before the first system run (design doc §3).
 *
 *   conservative  beta ≤ 0.9, dividend yield ≥ 2%, free cash flow > 0
 *   balanced      0.8 ≤ beta ≤ 1.2, free cash flow > 0
 *   aggressive    beta ≥ 1.1 OR revenue growth ≥ 10%
 *
 * Changing a threshold after the test set is frozen invalidates every
 * comparison; a test pins these values.
 */
import type { FundamentalsRow } from "../data/sources.ts";
import type { Profile } from "../schemas/index.ts";

export const RULES = {
  conservative: { maxBeta: 0.9, minDividendYieldPct: 2 },
  balanced: { minBeta: 0.8, maxBeta: 1.2 },
  aggressive: { minBeta: 1.1, minRevenueGrowthPct: 10 },
} as const;

export interface RuleResult {
  pass: boolean;
  /** Human-readable reasons for each failed condition; empty when it passes. */
  failures: string[];
}

type Row = Pick<FundamentalsRow, "beta" | "dividendYieldPct" | "revenueGrowthPct" | "freeCashFlowUsd">;

export function checkProfile(row: Row, profile: Profile): RuleResult {
  const failures: string[] = [];
  switch (profile) {
    case "conservative": {
      const r = RULES.conservative;
      if (!(row.beta <= r.maxBeta)) failures.push(`beta ${row.beta} > ${r.maxBeta}`);
      if (!(row.dividendYieldPct >= r.minDividendYieldPct)) failures.push(`dividend yield ${row.dividendYieldPct}% < ${r.minDividendYieldPct}%`);
      if (!(row.freeCashFlowUsd > 0)) failures.push("free cash flow ≤ 0");
      break;
    }
    case "balanced": {
      const r = RULES.balanced;
      if (!(row.beta >= r.minBeta && row.beta <= r.maxBeta)) failures.push(`beta ${row.beta} outside ${r.minBeta}–${r.maxBeta}`);
      if (!(row.freeCashFlowUsd > 0)) failures.push("free cash flow ≤ 0");
      break;
    }
    case "aggressive": {
      const r = RULES.aggressive;
      if (!(row.beta >= r.minBeta || row.revenueGrowthPct >= r.minRevenueGrowthPct)) {
        failures.push(`beta ${row.beta} < ${r.minBeta} and revenue growth ${row.revenueGrowthPct}% < ${r.minRevenueGrowthPct}%`);
      }
      break;
    }
  }
  return { pass: failures.length === 0, failures };
}

export const passesProfile = (row: Row, profile: Profile) => checkProfile(row, profile).pass;

// ---------------------------------------------------------------- portfolio band

/**
 * The portfolio-level band each profile implies for WEIGHTED BETA. A portfolio
 * outside its band is "mismatched"; the gap-flag and gap-reduction metrics
 * use this. Beta alone is used so mismatch has one unambiguous number.
 */
export const BETA_BAND: Record<Profile, { min: number; max: number }> = {
  conservative: { min: Number.NEGATIVE_INFINITY, max: RULES.conservative.maxBeta },
  balanced: { min: RULES.balanced.minBeta, max: RULES.balanced.maxBeta },
  aggressive: { min: RULES.aggressive.minBeta, max: Number.POSITIVE_INFINITY },
};

/** 0 inside the band, otherwise how far weighted beta sits outside it. */
export function betaGap(weightedBeta: number, profile: Profile): number {
  const { min, max } = BETA_BAND[profile];
  if (weightedBeta < min) return min - weightedBeta;
  if (weightedBeta > max) return weightedBeta - max;
  return 0;
}

export const isMismatched = (weightedBeta: number, profile: Profile) => betaGap(weightedBeta, profile) > 0;
