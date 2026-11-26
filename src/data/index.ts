/**
 * Builds the data sources a run uses from config. Systems receive these and
 * never know which mode they are in. Evals pass `forEval(config)`, which
 * forces snapshot mode.
 */
import type { Config } from "../config.ts";
import { FinnhubClient } from "./finnhub.ts";
import { liveFundamentalsSource, snapshotFundamentalsSource } from "./fundamentals.ts";
import { liveNewsSource, snapshotNewsSource } from "./news.ts";
import type { FundamentalsSource, NewsSource } from "./sources.ts";
import { loadUniverse, type Universe } from "./universe.ts";

export interface DataSources {
  universe: Universe;
  fundamentals: FundamentalsSource;
  news: NewsSource;
}

export function createDataSources(config: Config, universe: Universe = loadUniverse()): DataSources {
  const { data } = config;
  const needsClient = data.fundamentalsMode === "live" || data.newsMode === "live";
  const key = data.fundamentalsApiKey ?? data.newsApiKey;
  if (needsClient && !key) throw new Error("live data mode needs FUNDAMENTALS_API_KEY / NEWS_API_KEY in .env");
  const client = needsClient ? new FinnhubClient({ apiKey: key! }) : undefined;
  const members = universe.members;

  return {
    universe,
    fundamentals:
      data.fundamentalsMode === "live"
        ? liveFundamentalsSource({ client: client!, members })
        : snapshotFundamentalsSource({ date: data.snapshotDate }),
    news:
      data.newsMode === "live"
        ? liveNewsSource({ client: client!, members })
        : snapshotNewsSource({ date: data.snapshotDate }),
  };
}
