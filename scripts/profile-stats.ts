/**
 * Sanity check before the thresholds freeze: how many universe stocks pass
 * each profile rule on the snapshot, and by sector. Any profile with < 10
 * passing stocks means the rules need changing NOW, before the test set.
 *
 *   pnpm stats:profiles [YYYY-MM-DD]
 */
import { snapshotFundamentalsSource } from "../src/data/fundamentals.ts";
import { checkProfile } from "../src/rules/profile.ts";
import { Profile } from "../src/schemas/index.ts";

const src = snapshotFundamentalsSource({ date: process.argv[2] });
const rows = await src.getAll();
console.log(`snapshot ${await src.asOf()}: ${rows.length} stocks\n`);

const pct = (xs: number[], p: number) => xs.toSorted((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!;
const betas = rows.map((r) => r.beta);
console.log(`beta     min ${Math.min(...betas).toFixed(2)}  p25 ${pct(betas, 0.25).toFixed(2)}  median ${pct(betas, 0.5).toFixed(2)}  p75 ${pct(betas, 0.75).toFixed(2)}  max ${Math.max(...betas).toFixed(2)}`);
console.log(`yield≥2% ${rows.filter((r) => r.dividendYieldPct >= 2).length}   FCF>0 ${rows.filter((r) => r.freeCashFlowUsd > 0).length}   growth≥10% ${rows.filter((r) => r.revenueGrowthPct >= 10).length}\n`);

for (const profile of Profile.options) {
  const passing = rows.filter((r) => checkProfile(r, profile).pass);
  const sectors = Object.entries(Object.groupBy(passing, (r) => r.sector))
    .map(([s, rs]) => [s, rs!.length] as const)
    .sort((a, b) => b[1] - a[1]);
  const flag = passing.length < 10 ? "  ← FEWER THAN 10" : "";
  console.log(`${profile.padEnd(12)} ${String(passing.length).padStart(3)} pass, ${sectors.length} sectors${flag}`);
  console.log(`  ${sectors.map(([s, n]) => `${s} ${n}`).join(", ")}`);
  console.log(`  ${passing.map((r) => r.ticker).join(" ")}\n`);
}
