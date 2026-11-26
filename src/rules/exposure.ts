/**
 * Portfolio exposure, computed in code (never by the LLM): sector weights and
 * weighted beta / dividend yield / revenue growth, before and after adding picks.
 *
 * Holdings missing from the fundamentals snapshot are reported and left out;
 * the remaining weights are renormalised so the averages stay meaningful.
 *
 * Adding picks: each pick gets PICK_WEIGHT (5%); existing holdings are scaled
 * down proportionally so the total stays 1. A pick already held adds to that
 * holding's weight (portfolio-fit separately fails "already held").
 */
import type { FundamentalsRow } from "../data/sources.ts";
import type { Holding } from "../schemas/index.ts";

export const PICK_WEIGHT = 0.05;
/** Portfolio-fit fails if any sector exceeds this after adding picks. */
export const MAX_SECTOR_WEIGHT = 0.4;

export interface Exposure {
  sectorWeights: Record<string, number>;
  weightedBeta: number;
  weightedDividendYieldPct: number;
  weightedRevenueGrowthPct: number;
  /** Largest sector and its weight. */
  topSector: { sector: string; weight: number };
  /** Holdings not found in the fundamentals snapshot. */
  unknownTickers: string[];
  /** Share of the input weight that was found (1 = all). */
  coveredWeight: number;
}

const round = (x: number, dp = 4) => Math.round(x * 10 ** dp) / 10 ** dp;

export function computeExposure(holdings: Holding[], lookup: (ticker: string) => FundamentalsRow | undefined): Exposure {
  const known: { h: Holding; row: FundamentalsRow }[] = [];
  const unknownTickers: string[] = [];
  for (const h of holdings) {
    const row = lookup(h.ticker);
    if (row) known.push({ h, row });
    else unknownTickers.push(h.ticker);
  }
  const total = holdings.reduce((s, h) => s + h.weight, 0);
  const covered = known.reduce((s, k) => s + k.h.weight, 0);
  if (covered === 0) throw new Error(`no holdings found in the fundamentals snapshot (${unknownTickers.join(", ")})`);

  const sectorWeights: Record<string, number> = {};
  let beta = 0, yieldPct = 0, growth = 0;
  for (const { h, row } of known) {
    const w = h.weight / covered;
    sectorWeights[row.sector] = (sectorWeights[row.sector] ?? 0) + w;
    beta += w * row.beta;
    yieldPct += w * row.dividendYieldPct;
    growth += w * row.revenueGrowthPct;
  }
  for (const s of Object.keys(sectorWeights)) sectorWeights[s] = round(sectorWeights[s]!);
  const [topName, topWeight] = Object.entries(sectorWeights).sort((a, b) => b[1] - a[1])[0]!;

  return {
    sectorWeights,
    weightedBeta: round(beta),
    weightedDividendYieldPct: round(yieldPct),
    weightedRevenueGrowthPct: round(growth),
    topSector: { sector: topName, weight: topWeight },
    unknownTickers,
    coveredWeight: round(covered / total),
  };
}

/** Holdings after adding each pick at `pickWeight`, existing weights scaled down. */
export function addPicks(holdings: Holding[], picks: string[], pickWeight = PICK_WEIGHT): Holding[] {
  const unique = [...new Set(picks)];
  const added = unique.length * pickWeight;
  if (added >= 1) throw new Error(`${unique.length} picks × ${pickWeight} leaves no weight for holdings`);
  const scale = 1 - added;
  const total = holdings.reduce((s, h) => s + h.weight, 0);
  const byTicker = new Map<string, number>();
  for (const h of holdings) byTicker.set(h.ticker, (byTicker.get(h.ticker) ?? 0) + (h.weight / total) * scale);
  for (const p of unique) byTicker.set(p, (byTicker.get(p) ?? 0) + pickWeight);
  return [...byTicker].map(([ticker, weight]) => ({ ticker, weight: round(weight, 6) }));
}

export interface FitCheck {
  pass: boolean;
  alreadyHeld: string[];
  /** Sectors above MAX_SECTOR_WEIGHT after adding the picks. */
  overweightSectors: { sector: string; weight: number }[];
  after: Exposure;
}

/** Portfolio-fit rule: no pick already held, no sector above 40% after adding picks. */
export function checkPortfolioFit(
  holdings: Holding[],
  picks: string[],
  lookup: (ticker: string) => FundamentalsRow | undefined,
): FitCheck {
  const held = new Set(holdings.map((h) => h.ticker));
  const alreadyHeld = picks.filter((p) => held.has(p));
  const after = computeExposure(addPicks(holdings, picks), lookup);
  const overweightSectors = Object.entries(after.sectorWeights)
    .filter(([, w]) => w > MAX_SECTOR_WEIGHT)
    .map(([sector, weight]) => ({ sector, weight }));
  return { pass: alreadyHeld.length === 0 && overweightSectors.length === 0, alreadyHeld, overweightSectors, after };
}
