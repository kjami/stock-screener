/**
 * Picks 30 headlines from the news snapshot for hand labelling (sentiment
 * accuracy metric) and writes data/testset/headline-labels.json with every
 * label set to null. YOU fill in the labels; nothing here guesses them.
 *
 * Selection is deterministic: round-robin across GICS sectors, one headline
 * per ticker, cycling through each ticker's top-5 position so the set is not
 * all "newest" items.
 *
 *   pnpm testset:headlines [YYYY-MM-DD]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { listSnapshotDates } from "../src/data/fundamentals.ts";
import { newsPath, readNewsSnapshot } from "../src/data/news.ts";
import { loadUniverse } from "../src/data/universe.ts";

const OUT = "data/testset/headline-labels.json";
const N = 30;

if (existsSync(OUT)) {
  console.error(`${OUT} already exists; refusing to overwrite labels. Delete it first if you really mean to re-pick.`);
  process.exit(1);
}

const date = process.argv[2] ?? listSnapshotDates("news")[0];
if (!date) throw new Error("no news snapshot; run pnpm snapshot news");
const snap = readNewsSnapshot(newsPath(date));
const { members } = loadUniverse();

const byTicker = Object.groupBy(snap.items, (i) => i.ticker);
const sectors = Object.entries(Object.groupBy(members.filter((m) => byTicker[m.ticker]?.length), (m) => m.sector))
  .map(([sector, ms]) => ({ sector, queue: [...ms!] }))
  .sort((a, b) => a.sector.localeCompare(b.sector));

const picked: { newsId: string; ticker: string; sector: string; headline: string; summary: string; label: null; note: string }[] = [];
let round = 0;
while (picked.length < N && sectors.some((s) => s.queue.length)) {
  for (const s of sectors) {
    const m = s.queue.shift();
    if (!m || picked.length >= N) continue;
    const items = byTicker[m.ticker]!;
    const item = items[(picked.length + round) % items.length]!;
    picked.push({ newsId: item.newsId, ticker: m.ticker, sector: s.sector, headline: item.headline, summary: item.summary, label: null, note: "" });
  }
  round++;
}

mkdirSync("data/testset", { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      newsSnapshot: date,
      instructions:
        "Set each label to \"positive\", \"neutral\" or \"negative\": is this headline good, neutral or bad news for THIS company (ticker)? Judge from the headline and summary only. Use note for anything ambiguous. Commit before any system runs.",
      items: picked,
    },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${OUT}: ${picked.length} headlines from ${new Set(picked.map((p) => p.sector)).size} sectors, ${new Set(picked.map((p) => p.ticker)).size} tickers`);
