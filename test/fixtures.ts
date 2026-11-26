import type { InvestorInput, Output, Recommendation } from "../src/schemas/index.ts";

export const validInput: InvestorInput = {
  profile: "conservative",
  holdings: [
    { ticker: "AAPL", weight: 0.4 },
    { ticker: "MSFT", weight: 0.35 },
    { ticker: "BRK.B", weight: 0.25 },
  ],
};

export const validRecommendation: Recommendation = {
  ticker: "JNJ",
  keyMetrics: { beta: 0.55, dividendYieldPct: 3.1, revenueGrowthPct: 4.2, freeCashFlowUsd: 18_000_000_000, sector: "Health Care" },
  rationale: "Low beta and a 3.1% yield fit a conservative profile; MD&A reports stable pharmaceutical cash flow.",
  citations: [{ chunkId: "JNJ-7-0012", ticker: "JNJ", section: "7" }],
  mainRisk: "Talc litigation outcomes (Item 1A).",
  fitEffect: {
    sectorConcentration: "Adds Health Care, which the holdings lack; Tech falls from 75% to about 71%.",
    overlap: "Not currently held.",
    gapEffect: "Lowers weighted beta toward the conservative band.",
  },
  newsSentiment: {
    label: "neutral",
    reason: "Headlines mix a dividend raise with ongoing litigation.",
    citations: [{ newsId: "JNJ-2026-11-20-01", ticker: "JNJ" }],
  },
};

export const validOutput: Output = {
  recommendations: [validRecommendation],
  profileGap: { detected: true, explanation: "Holdings are 75% Tech with weighted beta above the conservative band." },
};
