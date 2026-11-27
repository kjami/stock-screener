import { describe, expect, it } from "vitest";
import type { FundamentalsRow } from "../src/data/sources.ts";
import { addPicks, checkPortfolioFit, computeExposure } from "../src/rules/exposure.ts";
import { BETA_BAND, betaGap, checkProfile, isMismatched, RULES } from "../src/rules/profile.ts";

const row = (ticker: string, sector: string, beta: number, dividendYieldPct = 0, revenueGrowthPct = 5, freeCashFlowUsd = 1e9): FundamentalsRow =>
  ({ ticker, name: ticker, sector, beta, dividendYieldPct, revenueGrowthPct, freeCashFlowUsd });

describe("profile rules", () => {
  it("pins the locked thresholds", () => {
    expect(RULES).toEqual({
      conservative: { maxBeta: 0.9, minDividendYieldPct: 2 },
      balanced: { minBeta: 0.8, maxBeta: 1.2 },
      aggressive: { minBeta: 1.1, minRevenueGrowthPct: 10 },
    });
  });

  it("conservative needs low beta, ≥2% yield and positive FCF, inclusive at the edges", () => {
    expect(checkProfile(row("A", "X", 0.9, 2), "conservative").pass).toBe(true);
    expect(checkProfile(row("A", "X", 0.91, 3), "conservative").failures).toEqual(["beta 0.91 > 0.9"]);
    expect(checkProfile(row("A", "X", 0.5, 1.99), "conservative").pass).toBe(false);
    expect(checkProfile(row("A", "X", 0.5, 3, 5, -1), "conservative").failures).toEqual(["free cash flow ≤ 0"]);
    expect(checkProfile(row("A", "X", 0.5, 3, 5, 0), "conservative").pass).toBe(false);
  });

  it("balanced needs 0.8 ≤ beta ≤ 1.2 and positive FCF", () => {
    expect(checkProfile(row("A", "X", 0.8), "balanced").pass).toBe(true);
    expect(checkProfile(row("A", "X", 1.2), "balanced").pass).toBe(true);
    expect(checkProfile(row("A", "X", 0.79), "balanced").pass).toBe(false);
    expect(checkProfile(row("A", "X", 1.0, 0, 5, -5), "balanced").pass).toBe(false);
  });

  it("aggressive passes on high beta OR high growth, even with negative FCF", () => {
    expect(checkProfile(row("A", "X", 1.1, 0, 0), "aggressive").pass).toBe(true);
    expect(checkProfile(row("A", "X", 0.5, 0, 10), "aggressive").pass).toBe(true);
    expect(checkProfile(row("A", "X", 1.5, 0, 0, -1e9), "aggressive").pass).toBe(true);
    expect(checkProfile(row("A", "X", 1.09, 0, 9.9), "aggressive").pass).toBe(false);
  });
});

describe("beta band", () => {
  it("measures distance outside the profile band", () => {
    expect(betaGap(0.85, "conservative")).toBe(0);
    expect(betaGap(1.2, "conservative")).toBeCloseTo(0.3);
    expect(betaGap(0.6, "balanced")).toBeCloseTo(0.2);
    expect(betaGap(1.3, "balanced")).toBeCloseTo(0.1);
    expect(betaGap(0.7, "aggressive")).toBeCloseTo(0.4);
    expect(isMismatched(1.5, "aggressive")).toBe(false);
    expect(BETA_BAND.balanced).toEqual({ min: 0.8, max: 1.2 });
  });
});

const data = new Map([
  ["AAPL", row("AAPL", "Information Technology", 1.2, 0.5, 15)],
  ["MSFT", row("MSFT", "Information Technology", 1.0, 0.8, 12)],
  ["JNJ", row("JNJ", "Health Care", 0.5, 3.0, 5)],
  ["KO", row("KO", "Consumer Staples", 0.6, 3.0, 2)],
]);
const lookup = (t: string) => data.get(t);

describe("computeExposure", () => {
  it("weights sectors and metrics by holding weight", () => {
    const e = computeExposure([{ ticker: "AAPL", weight: 0.5 }, { ticker: "MSFT", weight: 0.25 }, { ticker: "JNJ", weight: 0.25 }], lookup);
    expect(e.sectorWeights).toEqual({ "Information Technology": 0.75, "Health Care": 0.25 });
    expect(e.weightedBeta).toBeCloseTo(0.5 * 1.2 + 0.25 * 1.0 + 0.25 * 0.5);
    expect(e.weightedDividendYieldPct).toBeCloseTo(0.25 + 0.2 + 0.75);
    expect(e.topSector).toEqual({ sector: "Information Technology", weight: 0.75 });
    expect(e.unknownTickers).toEqual([]);
    expect(e.coveredWeight).toBe(1);
  });

  it("renormalises over known holdings and reports unknown ones", () => {
    const e = computeExposure([{ ticker: "JNJ", weight: 0.5 }, { ticker: "ZZZ", weight: 0.5 }], lookup);
    expect(e.unknownTickers).toEqual(["ZZZ"]);
    expect(e.coveredWeight).toBe(0.5);
    expect(e.weightedBeta).toBe(0.5);
  });

  it("throws when nothing is known", () => {
    expect(() => computeExposure([{ ticker: "ZZZ", weight: 1 }], lookup)).toThrow(/no holdings/);
  });
});

describe("addPicks", () => {
  it("gives each pick 5% and scales holdings down so the total stays 1", () => {
    const after = addPicks([{ ticker: "AAPL", weight: 0.6 }, { ticker: "MSFT", weight: 0.4 }], ["JNJ", "KO"]);
    expect(after).toEqual([
      { ticker: "AAPL", weight: 0.54 },
      { ticker: "MSFT", weight: 0.36 },
      { ticker: "JNJ", weight: 0.05 },
      { ticker: "KO", weight: 0.05 },
    ]);
    expect(after.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(1);
  });

  it("merges a pick that is already held and ignores duplicate picks", () => {
    const after = addPicks([{ ticker: "AAPL", weight: 1 }], ["AAPL", "JNJ", "JNJ"]);
    expect(after).toEqual([{ ticker: "AAPL", weight: 0.95 }, { ticker: "JNJ", weight: 0.05 }]);
  });
});

describe("checkPortfolioFit", () => {
  const techHeavy = [{ ticker: "AAPL", weight: 0.5 }, { ticker: "MSFT", weight: 0.5 }];

  it("passes a 100% tech portfolio when picks go elsewhere (it cannot drop below 40%, but does not get worse)", () => {
    const fit = checkPortfolioFit(techHeavy, ["JNJ", "KO"], lookup);
    expect(fit.pass).toBe(true);
    expect(fit.after.sectorWeights["Information Technology"]).toBeCloseTo(0.9);
  });

  it("fails a pick into a sector already above 40%", () => {
    const fit = checkPortfolioFit([{ ticker: "AAPL", weight: 0.6 }, { ticker: "JNJ", weight: 0.4 }], ["MSFT"], lookup);
    expect(fit.pass).toBe(false);
    expect(fit.picksIntoOverweight).toEqual([{ ticker: "MSFT", sector: "Information Technology", weightBefore: 0.6 }]);
  });

  it("fails when picks push a sector from ≤ 40% to above it", () => {
    // Health Care 40% before; two more health-care-like picks would push it over.
    data.set("PFE", row("PFE", "Health Care", 0.3, 4, 1));
    data.set("MRK", row("MRK", "Health Care", 0.2, 3, 2));
    const fit = checkPortfolioFit([{ ticker: "JNJ", weight: 0.4 }, { ticker: "KO", weight: 0.3 }, { ticker: "AAPL", weight: 0.3 }], ["PFE", "MRK"], lookup);
    expect(fit.newlyOverweight).toEqual([{ sector: "Health Care", before: 0.4, after: expect.closeTo(0.46, 5) }]);
    expect(fit.pass).toBe(false);
  });

  it("fails an unknown pick", () => {
    expect(checkPortfolioFit(techHeavy, ["ZZZ"], lookup).unknownPicks).toEqual(["ZZZ"]);
  });

  it("fails when a pick is already held", () => {
    const fit = checkPortfolioFit([{ ticker: "JNJ", weight: 0.3 }, { ticker: "KO", weight: 0.3 }, { ticker: "AAPL", weight: 0.4 }], ["JNJ"], lookup);
    expect(fit.alreadyHeld).toEqual(["JNJ"]);
    expect(fit.pass).toBe(false);
  });

  it("passes a diversified result", () => {
    const fit = checkPortfolioFit([{ ticker: "JNJ", weight: 0.4 }, { ticker: "KO", weight: 0.35 }, { ticker: "AAPL", weight: 0.25 }], ["MSFT"], lookup);
    expect(fit.pass).toBe(true);
  });
});
