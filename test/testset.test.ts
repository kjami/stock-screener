import { describe, expect, it } from "vitest";
import type { FundamentalsRow } from "../src/data/sources.ts";
import { checkCase, checkTestSetShape, type TestCase, type TestSet } from "../src/eval/testset.ts";

const row = (ticker: string, sector: string, beta: number): FundamentalsRow =>
  ({ ticker, name: ticker, sector, beta, dividendYieldPct: 2, revenueGrowthPct: 5, freeCashFlowUsd: 1 });
const data = new Map(["AA", "BB", "CC", "DD", "EE"].map((t, i) => [t, row(t, i < 3 ? "Tech" : "Health Care", 1.5)]));
const lookup = (t: string) => data.get(t);
const holdings = ["AA", "BB", "CC", "DD", "EE"].map((ticker) => ({ ticker, weight: 0.2 }));

const mk = (id: string, profile: TestCase["input"]["profile"], mismatch: boolean, variance = false): TestCase =>
  ({ id, input: { profile, holdings }, mismatch, variance, intent: "test" });

describe("checkCase", () => {
  it("agrees when the label matches the weighted beta", () => {
    const r = checkCase(mk("con-01", "conservative", true), lookup);
    expect(r).toMatchObject({ weightedBeta: 1.5, computedMismatch: true, topSector: "Tech", problems: [] });
    expect(r.betaGap).toBeCloseTo(0.6);
  });

  it("flags a wrong mismatch label, unknown tickers and an id/profile mix-up", () => {
    const c = mk("bal-01", "aggressive", true);
    c.input = { ...c.input, holdings: [...holdings.slice(0, 4), { ticker: "ZZ", weight: 0.2 }] };
    const r = checkCase(c, lookup);
    expect(r.problems.join(" | ")).toMatch(/not in snapshot: ZZ/);
    expect(r.problems.join(" | ")).toMatch(/id prefix/);
    expect(r.problems.join(" | ")).toMatch(/labelled mismatch=true/);
  });
});

describe("checkTestSetShape", () => {
  const build = (): TestSet => ({
    fundamentalsSnapshot: "2026-11-25",
    cases: (["con", "bal", "agg"] as const).flatMap((p, pi) =>
      Array.from({ length: 10 }, (_, i) =>
        mk(`${p}-${String(i + 1).padStart(2, "0")}`, (["conservative", "balanced", "aggressive"] as const)[pi]!, i < 4, i === 0 || i === 5 || i === 6 || (pi === 0 && i === 7)),
      ),
    ),
  });

  it("accepts 10 per profile, 4 mismatched, 10 variance cases incl. mismatched ones", () => {
    expect(checkTestSetShape(build())).toEqual([]);
  });

  it("reports a wrong mismatch split", () => {
    const set = build();
    set.cases[4]!.mismatch = true;
    expect(checkTestSetShape(set)).toContain("conservative: 5 mismatched (want 4)");
  });
});
