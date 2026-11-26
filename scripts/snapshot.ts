/**
 * Takes the fundamentals + news snapshot for today (local date) from Finnhub.
 * About 300 calls (metric + profile + news per ticker), ~6 minutes at the
 * free plan's rate limit.
 *
 *   pnpm snapshot                 # both
 *   pnpm snapshot fundamentals    # one
 *   pnpm snapshot news
 */
import { loadConfigFromProcess } from "../src/config.ts";
import { FinnhubClient } from "../src/data/finnhub.ts";
import { fetchFundamentalsSnapshot, writeFundamentalsSnapshot } from "../src/data/fundamentals.ts";
import { fetchNewsSnapshot, writeNewsSnapshot } from "../src/data/news.ts";
import { loadUniverse } from "../src/data/universe.ts";

const config = await loadConfigFromProcess();
const key = config.data.fundamentalsApiKey ?? config.data.newsApiKey;
if (!key) throw new Error("FUNDAMENTALS_API_KEY is not set in .env");

const which = process.argv[2] ?? "all";
const client = new FinnhubClient({ apiKey: key });
const { members } = loadUniverse();
const asOf = new Date().toLocaleDateString("en-CA");
const progress = (label: string) => (done: number, total: number, t: string) => {
  if (done % 10 === 0 || done === total) console.log(`${label} ${done}/${total} (${t})`);
};

if (which === "all" || which === "fundamentals") {
  const snap = await fetchFundamentalsSnapshot(client, members, asOf, progress("fundamentals"));
  const path = writeFundamentalsSnapshot(snap);
  console.log(`wrote ${path}: ${snap.rows.length} rows, ${snap.dropped.length} dropped`);
  for (const d of snap.dropped) console.log(`  dropped ${d.ticker}: ${d.reason}`);
  for (const o of snap.overrides) console.log(`  override ${o.ticker}.${o.field}: ${o.original} → ${o.used}`);
}

if (which === "all" || which === "news") {
  const snap = await fetchNewsSnapshot(client, members, asOf, progress("news"));
  const path = writeNewsSnapshot(snap);
  const perTicker = Object.groupBy(snap.items, (i) => i.ticker);
  const empty = members.filter((m) => !perTicker[m.ticker]).map((m) => m.ticker);
  console.log(`wrote ${path}: ${snap.items.length} items, window ${snap.window.from}..${snap.window.to}, ${snap.failed.length} failed`);
  console.log(`  tickers with no company-specific news: ${empty.length ? empty.join(", ") : "none"}`);
  for (const f of snap.failed) console.log(`  failed ${f.ticker}: ${f.reason}`);
}
