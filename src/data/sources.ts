/**
 * Data-source contracts. Every system reads fundamentals and news through
 * these interfaces and cannot tell which mode it is in:
 *
 *   snapshot: reads a dated JSON file under data/snapshot/ (evals always use this)
 *   live:     fetches from the provider; fundamentals refresh at most once a day
 *             into a new dated file, news is cached per ticker per day and
 *             saved in the run log so any live run can be replayed
 *
 * Implementations arrive in Increment 1, once the data provider is chosen.
 */
import { z } from "zod";
import type { DataMode } from "../config.ts";
import { Ticker } from "../schemas/index.ts";

// ---------------------------------------------------------------- fundamentals

export const FundamentalsRow = z.object({
  ticker: Ticker,
  name: z.string().min(1),
  sector: z.string().min(1),
  beta: z.number(),
  dividendYieldPct: z.number().min(0),
  revenueGrowthPct: z.number(),
  freeCashFlowUsd: z.number(),
});
export type FundamentalsRow = z.infer<typeof FundamentalsRow>;

export const FundamentalsSnapshot = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1),
  rows: z.array(FundamentalsRow).min(1),
});
export type FundamentalsSnapshot = z.infer<typeof FundamentalsSnapshot>;

export interface FundamentalsSource {
  readonly mode: DataMode;
  /** Date of the data being read: the snapshot date, or the day the live file was written. */
  asOf(): Promise<string>;
  getAll(): Promise<FundamentalsRow[]>;
  /** Undefined for a ticker outside the universe; callers turn that into a tool error, not a throw. */
  get(ticker: string): Promise<FundamentalsRow | undefined>;
}

// ---------------------------------------------------------------- news

export const NewsItem = z.object({
  newsId: z.string().min(1),
  ticker: Ticker,
  publishedAt: z.iso.datetime({ offset: true }),
  headline: z.string().min(1),
  summary: z.string(),
  source: z.string(),
  url: z.url().nullable(),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const NewsSnapshot = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1),
  items: z.array(NewsItem),
});
export type NewsSnapshot = z.infer<typeof NewsSnapshot>;

export const NEWS_TOP_K = 5;

export interface NewsSource {
  readonly mode: DataMode;
  /**
   * Up to `k` most recent headlines for a ticker, newest first.
   * Live mode returns [] (never throws) when the provider fails, and the
   * caller reports sentiment as "unavailable".
   */
  getTopNews(ticker: string, k?: number): Promise<NewsItem[]>;
}
