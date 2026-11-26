/**
 * Zod schemas: the contract between the systems (S0–S3) and the evaluator.
 *
 * Schemas the LLM fills (Output and everything under it) use `.nullable()`
 * rather than `.optional()`: OpenAI's strict structured output requires every
 * field to be present, and `null` keeps the shape portable across providers.
 *
 * Cross-checks that need data (ticker in the universe, citation exists in the
 * index, citation ticker matches the pick) are NOT here. They live in the
 * validator and the metrics, so a bad citation is a measured failure rather
 * than a schema rejection of the whole output.
 */
import { z } from "zod";

// ---------------------------------------------------------------- primitives

/** US ticker as listed in the S&P 100 snapshot, e.g. AAPL, BRK.B. */
export const Ticker = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{0,5}([.-][A-Z])?$/, "ticker must be upper-case, e.g. AAPL or BRK.B");
export type Ticker = z.infer<typeof Ticker>;

export const Profile = z.enum(["conservative", "balanced", "aggressive"]);
export type Profile = z.infer<typeof Profile>;

/** 10-K sections that are ingested: 1A Risk Factors, 7 MD&A. */
export const FilingSection = z.enum(["1A", "7"]);
export type FilingSection = z.infer<typeof FilingSection>;

export const SentimentLabel = z.enum(["positive", "neutral", "negative"]);
export type SentimentLabel = z.infer<typeof SentimentLabel>;

// ---------------------------------------------------------------- input

/** Tolerance for "weights sum to 1" (rounded user input). */
export const WEIGHT_SUM_TOLERANCE = 0.01;

export const Holding = z.object({
  ticker: Ticker,
  weight: z.number().gt(0).lte(1),
});
export type Holding = z.infer<typeof Holding>;

export const InvestorInput = z
  .object({
    profile: Profile,
    holdings: z.array(Holding).min(1).max(15),
  })
  .superRefine((input, ctx) => {
    const sum = input.holdings.reduce((s, h) => s + h.weight, 0);
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({
        code: "custom",
        path: ["holdings"],
        message: `holding weights must sum to 1 (±${WEIGHT_SUM_TOLERANCE}); got ${sum.toFixed(4)}`,
      });
    }
    const seen = new Set<string>();
    for (const [i, h] of input.holdings.entries()) {
      if (seen.has(h.ticker)) {
        ctx.addIssue({ code: "custom", path: ["holdings", i, "ticker"], message: `duplicate holding ${h.ticker}` });
      }
      seen.add(h.ticker);
    }
  });
export type InvestorInput = z.infer<typeof InvestorInput>;

// ---------------------------------------------------------------- citations

/** Points at one chunk of the 10-K index. */
export const FilingCitation = z.object({
  chunkId: z.string().min(1),
  ticker: Ticker,
  section: FilingSection,
});
export type FilingCitation = z.infer<typeof FilingCitation>;

/** Points at one headline in the news source (snapshot or a live run's log). */
export const NewsCitation = z.object({
  newsId: z.string().min(1),
  ticker: Ticker,
});
export type NewsCitation = z.infer<typeof NewsCitation>;

// ---------------------------------------------------------------- output

/** Metric values the rationale relies on. Null = not stated. */
export const KeyMetrics = z.object({
  beta: z.number().nullable(),
  dividendYieldPct: z.number().nullable(),
  revenueGrowthPct: z.number().nullable(),
  freeCashFlowUsd: z.number().nullable(),
  sector: z.string().nullable(),
});
export type KeyMetrics = z.infer<typeof KeyMetrics>;

/** How adding this pick changes the portfolio. Numbers come from getExposure, not the LLM. */
export const FitEffect = z.object({
  sectorConcentration: z.string().min(1),
  overlap: z.string().min(1),
  gapEffect: z.string().min(1),
});
export type FitEffect = z.infer<typeof FitEffect>;

/**
 * Sentiment of the pick's top recent headlines.
 * `unavailable` when no news could be read (live provider down, S0 has no tools).
 * Any other label must cite at least one headline.
 */
export const NewsSentiment = z
  .object({
    label: z.enum([...SentimentLabel.options, "unavailable"]),
    reason: z.string(),
    citations: z.array(NewsCitation),
  })
  .superRefine((s, ctx) => {
    if (s.label !== "unavailable" && s.citations.length === 0) {
      ctx.addIssue({ code: "custom", path: ["citations"], message: `sentiment "${s.label}" must cite at least one headline` });
    }
  });
export type NewsSentiment = z.infer<typeof NewsSentiment>;

export const Recommendation = z.object({
  ticker: Ticker,
  keyMetrics: KeyMetrics,
  rationale: z.string().min(1),
  citations: z.array(FilingCitation).min(1),
  mainRisk: z.string().min(1),
  fitEffect: FitEffect,
  newsSentiment: NewsSentiment.nullable(),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const ProfileGap = z.object({
  detected: z.boolean(),
  explanation: z.string().min(1),
});
export type ProfileGap = z.infer<typeof ProfileGap>;

export const MAX_RECOMMENDATIONS = 5;

export const Output = z
  .object({
    recommendations: z.array(Recommendation).max(MAX_RECOMMENDATIONS),
    profileGap: ProfileGap,
  })
  .superRefine((out, ctx) => {
    const seen = new Set<string>();
    for (const [i, r] of out.recommendations.entries()) {
      if (seen.has(r.ticker)) {
        ctx.addIssue({ code: "custom", path: ["recommendations", i, "ticker"], message: `duplicate recommendation ${r.ticker}` });
      }
      seen.add(r.ticker);
    }
  });
export type Output = z.infer<typeof Output>;
