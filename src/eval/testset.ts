/**
 * The 30-case test set: 3 profiles × 10 synthetic portfolios, 4 of 10 per
 * profile deliberately mismatched (weighted beta outside the profile band).
 * Written and frozen before any system runs.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { FundamentalsRow } from "../data/sources.ts";
import { computeExposure } from "../rules/exposure.ts";
import { betaGap, isMismatched } from "../rules/profile.ts";
import { InvestorInput, Profile, SentimentLabel } from "../schemas/index.ts";

/** Hand labels for the sentiment accuracy metric (data/testset/headline-labels.json). */
export const HeadlineLabels = z.object({
  newsSnapshot: z.string(),
  instructions: z.string(),
  items: z
    .array(
      z.object({
        newsId: z.string(),
        ticker: z.string(),
        sector: z.string(),
        headline: z.string(),
        summary: z.string(),
        label: SentimentLabel,
        note: z.string(),
      }),
    )
    .length(30),
});
export type HeadlineLabels = z.infer<typeof HeadlineLabels>;

export const HEADLINE_LABELS_PATH = "data/testset/headline-labels.json";

export function loadHeadlineLabels(path = HEADLINE_LABELS_PATH): HeadlineLabels {
  return HeadlineLabels.parse(JSON.parse(readFileSync(path, "utf8")));
}

export const TestCase = z.object({
  id: z.string().regex(/^(con|bal|agg)-\d{2}$/),
  input: InvestorInput,
  /** Expected: holdings' weighted beta is outside the profile's band. */
  mismatch: z.boolean(),
  /** Member of the 10-case subset repeated 3× for variance. */
  variance: z.boolean(),
  /** What the portfolio is meant to test, in a few words. */
  intent: z.string().min(1),
});
export type TestCase = z.infer<typeof TestCase>;

export const TestSet = z.object({
  fundamentalsSnapshot: z.string(),
  cases: z.array(TestCase).length(30),
});
export type TestSet = z.infer<typeof TestSet>;

export const TESTSET_PATH = "data/testset/cases.json";

export function loadTestSet(path = TESTSET_PATH): TestSet {
  return TestSet.parse(JSON.parse(readFileSync(path, "utf8")));
}

export interface CaseCheck {
  id: string;
  profile: Profile;
  holdings: number;
  weightedBeta: number;
  betaGap: number;
  topSector: string;
  topSectorWeight: number;
  expectedMismatch: boolean;
  computedMismatch: boolean;
  problems: string[];
}

/** Checks one case against the snapshot: tickers known, mismatch label agrees with the numbers. */
export function checkCase(c: TestCase, lookup: (t: string) => FundamentalsRow | undefined): CaseCheck {
  const problems: string[] = [];
  const unknown = c.input.holdings.filter((h) => !lookup(h.ticker)).map((h) => h.ticker);
  if (unknown.length) problems.push(`not in snapshot: ${unknown.join(", ")}`);
  if (c.input.holdings.length < 5) problems.push(`only ${c.input.holdings.length} holdings (min 5)`);
  if (!c.id.startsWith(c.input.profile.slice(0, 3))) problems.push(`id prefix does not match profile ${c.input.profile}`);

  const e = computeExposure(c.input.holdings, lookup);
  const computed = isMismatched(e.weightedBeta, c.input.profile);
  if (computed !== c.mismatch) problems.push(`labelled mismatch=${c.mismatch} but weighted beta ${e.weightedBeta} gives ${computed}`);
  return {
    id: c.id,
    profile: c.input.profile,
    holdings: c.input.holdings.length,
    weightedBeta: e.weightedBeta,
    betaGap: Math.round(betaGap(e.weightedBeta, c.input.profile) * 1000) / 1000,
    topSector: e.topSector.sector,
    topSectorWeight: e.topSector.weight,
    expectedMismatch: c.mismatch,
    computedMismatch: computed,
    problems,
  };
}

/** Whole-set structure checks (counts per profile, mismatch split, variance subset). */
export function checkTestSetShape(set: TestSet): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of set.cases) {
    if (ids.has(c.id)) problems.push(`duplicate id ${c.id}`);
    ids.add(c.id);
  }
  for (const p of Profile.options) {
    const cs = set.cases.filter((c) => c.input.profile === p);
    if (cs.length !== 10) problems.push(`${p}: ${cs.length} cases (want 10)`);
    const mm = cs.filter((c) => c.mismatch).length;
    if (mm !== 4) problems.push(`${p}: ${mm} mismatched (want 4)`);
    const v = cs.filter((c) => c.variance);
    if (v.length < 3) problems.push(`${p}: ${v.length} variance cases (want ≥ 3)`);
    if (!v.some((c) => c.mismatch)) problems.push(`${p}: variance subset has no mismatched case`);
  }
  const variance = set.cases.filter((c) => c.variance).length;
  if (variance !== 10) problems.push(`${variance} variance cases (want 10)`);
  return problems;
}
