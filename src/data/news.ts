/**
 * Company news from Finnhub, filtered to items about the company, plus the
 * snapshot and live NewsSource implementations.
 *
 * Finnhub's /company-news returns ~250 items for large caps, most of them
 * market-wide stories that merely tag the ticker. An item counts as being
 * about the company only if its headline or summary names it (company name
 * or alias, or the ticker as an upper-case word).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DataMode } from "../config.ts";
import { listSnapshotDates, SNAPSHOT_DIR } from "./fundamentals.ts";
import type { FinnhubClient, FinnhubNewsItem } from "./finnhub.ts";
import { NEWS_TOP_K, NewsSnapshot, type NewsItem, type NewsSource } from "./sources.ts";
import type { UniverseMember } from "./universe.ts";

/** Days before the as-of date that a news query covers. */
export const NEWS_WINDOW_DAYS = 30;

/** Names headlines use that the cleaned company name would miss. */
const ALIASES: Record<string, string[]> = {
  GOOGL: ["Google", "Alphabet"],
  META: ["Meta", "Facebook", "Instagram"],
  "BRK.B": ["Berkshire"],
  JPM: ["JPMorgan", "JP Morgan"],
  BNY: ["BNY"],
  AMD: ["AMD"],
  T: ["AT&T"],
  GS: ["Goldman"],
  MS: ["Morgan Stanley"],
  KO: ["Coca-Cola", "Coke"],
  PM: ["Philip Morris"],
  LOW: ["Lowe's", "Lowes"],
  NOW: ["ServiceNow"],
  COST: ["Costco"],
};

const SUFFIXES = /\b(inc\.?|incorporated|corporation|corp\.?|company|co\.?|holdings?|plc|group|ltd\.?|the)\b|\(class [a-z]\)|[.,]/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Patterns that mark an item as being about this company. */
export function companyMatchers(member: UniverseMember): RegExp[] {
  const cleaned = member.name.replace(SUFFIXES, " ").replace(/\s+/g, " ").trim();
  const names = new Set([cleaned, ...(ALIASES[member.ticker] ?? [])].filter((n) => n.length >= 3));
  const matchers = [...names].map((n) => new RegExp(`\\b${escape(n)}\\b`, "i"));
  // Ticker as an upper-case word (case-sensitive), skipped for 1-letter tickers like C, T, V.
  if (member.ticker.length >= 2) matchers.push(new RegExp(`(^|[^A-Za-z])\\$?${escape(member.ticker)}([^A-Za-z]|$)`));
  return matchers;
}

export function isAboutCompany(item: Pick<FinnhubNewsItem, "headline" | "summary">, matchers: RegExp[]): boolean {
  const text = `${item.headline}\n${item.summary}`;
  return matchers.some((re) => re.test(text));
}

export function toNewsItem(ticker: string, raw: FinnhubNewsItem): NewsItem {
  return {
    newsId: `${ticker}-${raw.id}`,
    ticker,
    publishedAt: new Date(raw.datetime * 1000).toISOString(),
    headline: raw.headline.trim(),
    summary: raw.summary.trim(),
    source: raw.source,
    url: /^https?:\/\//.test(raw.url) ? raw.url : null,
  };
}

/**
 * Filter to items about the company and drop repeated headlines. Items that
 * name the company in the headline come first (newest first); items that only
 * mention it in the summary fill any remaining slots. Top k.
 */
export function selectTopNews(member: UniverseMember, raw: FinnhubNewsItem[], k = NEWS_TOP_K): NewsItem[] {
  const matchers = companyMatchers(member);
  const inHeadline = (r: FinnhubNewsItem) => matchers.some((re) => re.test(r.headline));
  const seen = new Set<string>();
  return raw
    .filter((r) => r.headline && isAboutCompany(r, matchers))
    .sort((a, b) => Number(inHeadline(b)) - Number(inHeadline(a)) || b.datetime - a.datetime)
    .filter((r) => {
      const key = r.headline.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, k)
    .map((r) => toNewsItem(member.ticker, r));
}

export function newsWindow(asOf: string, days = NEWS_WINDOW_DAYS): { from: string; to: string } {
  const to = new Date(`${asOf}T00:00:00Z`);
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: asOf };
}

export async function fetchNewsSnapshot(
  client: FinnhubClient,
  members: UniverseMember[],
  asOf: string,
  onProgress?: (done: number, total: number, ticker: string) => void,
): Promise<NewsSnapshot> {
  const window = newsWindow(asOf);
  const items: NewsItem[] = [];
  const failed: { ticker: string; reason: string }[] = [];
  for (const [i, m] of members.entries()) {
    try {
      items.push(...selectTopNews(m, await client.companyNews(m.ticker, window.from, window.to)));
    } catch (err) {
      failed.push({ ticker: m.ticker, reason: err instanceof Error ? err.message : String(err) });
    }
    onProgress?.(i + 1, members.length, m.ticker);
  }
  return NewsSnapshot.parse({ asOf, provider: "finnhub", window, items, failed });
}

// ---------------------------------------------------------------- files

export const newsPath = (date: string, dir = SNAPSHOT_DIR) => join(dir, `news-${date}.json`);

export function writeNewsSnapshot(snapshot: NewsSnapshot, dir = SNAPSHOT_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = newsPath(snapshot.asOf, dir);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  return path;
}

export function readNewsSnapshot(path: string): NewsSnapshot {
  return NewsSnapshot.parse(JSON.parse(readFileSync(path, "utf8")));
}

// ---------------------------------------------------------------- sources

export function snapshotNewsSource(opts: { date?: string; dir?: string } = {}): NewsSource {
  let byTicker: Map<string, NewsItem[]> | undefined;
  const load = () => {
    if (byTicker) return byTicker;
    const date = opts.date ?? listSnapshotDates("news", opts.dir)[0];
    if (!date) throw new Error(`no news snapshot in ${opts.dir ?? SNAPSHOT_DIR}; run pnpm snapshot`);
    const snap = readNewsSnapshot(newsPath(date, opts.dir));
    byTicker = new Map();
    for (const item of snap.items) byTicker.set(item.ticker, [...(byTicker.get(item.ticker) ?? []), item]);
    return byTicker;
  };
  return {
    mode: "snapshot",
    async getTopNews(ticker, k = NEWS_TOP_K) {
      return (load().get(ticker) ?? []).slice(0, k);
    },
  };
}

/**
 * Live: fetches per ticker, cached per ticker per day under data/cache/news/.
 * Never throws: a failed fetch returns [] and the caller reports sentiment
 * as unavailable. Callers log what they used, so live runs can be replayed.
 */
export function liveNewsSource(opts: {
  client: FinnhubClient;
  members: UniverseMember[];
  cacheDir?: string;
  today?: () => string;
  onError?: (ticker: string, err: unknown) => void;
}): NewsSource {
  const today = opts.today ?? (() => new Date().toLocaleDateString("en-CA"));
  const byTicker = new Map(opts.members.map((m) => [m.ticker, m]));
  return {
    mode: "live",
    async getTopNews(ticker, k = NEWS_TOP_K) {
      const member = byTicker.get(ticker);
      if (!member) return [];
      const date = today();
      const dir = join(opts.cacheDir ?? "data/cache/news", date);
      const path = join(dir, `${ticker}.json`);
      try {
        if (existsSync(path)) return (JSON.parse(readFileSync(path, "utf8")) as NewsItem[]).slice(0, k);
        const { from, to } = newsWindow(date);
        const items = selectTopNews(member, await opts.client.companyNews(ticker, from, to));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, JSON.stringify(items, null, 2));
        return items.slice(0, k);
      } catch (err) {
        opts.onError?.(ticker, err);
        return [];
      }
    },
  };
}
