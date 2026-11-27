/**
 * Guards the frozen test set against unwinnable cases: for every case there
 * must exist 5 picks from the snapshot that pass the profile rule AND the
 * portfolio-fit rule. If this fails, a metric (not a system) would be scoring
 * the case.
 */
import { describe, expect, it } from "vitest";
import { readFundamentalsSnapshot, fundamentalsPath } from "../src/data/fundamentals.ts";
import { loadTestSet } from "../src/eval/testset.ts";
import { checkPortfolioFit, computeExposure } from "../src/rules/exposure.ts";
import { passesProfile } from "../src/rules/profile.ts";

const set = loadTestSet();
const rows = readFundamentalsSnapshot(fundamentalsPath(set.fundamentalsSnapshot)).rows;
const byTicker = new Map(rows.map((r) => [r.ticker, r]));
const lookup = (t: string) => byTicker.get(t);

/** Greedy: least-held sectors first, one pick per sector, profile-passing, not held. */
function findPassingPicks(caseIndex: number): string[] {
  const c = set.cases[caseIndex]!;
  const held = new Set(c.input.holdings.map((h) => h.ticker));
  const before = computeExposure(c.input.holdings, lookup).sectorWeights;
  const candidates = rows
    .filter((r) => !held.has(r.ticker) && passesProfile(r, c.input.profile))
    .sort((a, b) => (before[a.sector] ?? 0) - (before[b.sector] ?? 0));
  const picks: string[] = [];
  const usedSectors = new Set<string>();
  for (const r of candidates) {
    if (picks.length === 5) break;
    if (usedSectors.has(r.sector)) continue;
    picks.push(r.ticker);
    usedSectors.add(r.sector);
  }
  return picks;
}

describe("frozen test set is solvable", () => {
  it.each(set.cases.map((c, i) => [c.id, i] as const))("%s has 5 picks passing profile and fit rules", (_id, i) => {
    const picks = findPassingPicks(i);
    expect(picks).toHaveLength(5);
    const fit = checkPortfolioFit(set.cases[i]!.input.holdings, picks, lookup);
    expect({ picksIntoOverweight: fit.picksIntoOverweight, newlyOverweight: fit.newlyOverweight, alreadyHeld: fit.alreadyHeld }).toEqual({
      picksIntoOverweight: [],
      newlyOverweight: [],
      alreadyHeld: [],
    });
    expect(fit.pass).toBe(true);
  });
});
