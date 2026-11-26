/**
 * Freezes the S&P 100 constituent list (with GICS sectors) from Wikipedia's
 * "S&P 100" page, recording the page revision so the list is traceable.
 *
 *   pnpm freeze:universe
 *
 * Run once; the output is committed and not regenerated during the project.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { UNIVERSE_PATH, Universe, type UniverseMember } from "../src/data/universe.ts";

const PAGE = "S&P_100";
const API = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(PAGE)}&prop=wikitext|revid&format=json&formatversion=2`;

/** Second share classes of a company already in the list: recommending both is meaningless. */
const EXCLUDE: Record<string, string> = {
  GOOG: "Class C share of Alphabet; GOOGL (Class A) is kept",
};

const res = await fetch(API, { headers: { "User-Agent": "stock-screener-capstone/0.1 (educational project)" } });
if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
const body = (await res.json()) as { parse: { wikitext: string; revid: number } };
const text = body.parse.wikitext;

const start = text.indexOf('id="constituents"');
if (start < 0) throw new Error("constituents table not found");
const table = text.slice(start, text.indexOf("|}", start));

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");
const unlink = (s: string) => s.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1").replace(/<ref[\s\S]*?(?:\/>|<\/ref>)/g, "").trim();

const members: UniverseMember[] = [];
const excluded: { ticker: string; reason: string }[] = [];
for (const row of table.split(/\n\|-\n/).slice(1)) {
  const cells = stripComments(row).split("\n").filter((l) => l.startsWith("|")).map((l) => unlink(l.slice(1)));
  if (cells.length < 3) continue;
  const [ticker, name, sector] = cells as [string, string, string];
  if (EXCLUDE[ticker]) {
    excluded.push({ ticker, reason: EXCLUDE[ticker] });
    continue;
  }
  members.push({ ticker, name, sector } as UniverseMember);
}

const universe = Universe.parse({
  asOf: new Date().toLocaleDateString("en-CA"), // local YYYY-MM-DD
  source: { url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(PAGE)}&oldid=${body.parse.revid}`, revisionId: body.parse.revid },
  excluded,
  members: members.sort((a, b) => a.ticker.localeCompare(b.ticker)),
});

mkdirSync(dirname(UNIVERSE_PATH), { recursive: true });
writeFileSync(UNIVERSE_PATH, JSON.stringify(universe, null, 2) + "\n");

const bySector = Object.entries(Object.groupBy(universe.members, (m) => m.sector)).map(([s, ms]) => `${s}: ${ms?.length}`);
console.log(`${universe.members.length} members, ${excluded.length} excluded, revision ${body.parse.revid}`);
console.log(bySector.join("\n"));
