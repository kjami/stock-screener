/**
 * Verifies data/testset/cases.json against the fundamentals snapshot it names:
 * shape (10 per profile, 4 mismatched, 10 variance cases) and that every
 * mismatch label agrees with the computed weighted beta. Exits 1 on problems.
 *
 *   pnpm testset:verify
 */
import { snapshotFundamentalsSource } from "../src/data/fundamentals.ts";
import { checkCase, checkTestSetShape, loadTestSet } from "../src/eval/testset.ts";

const set = loadTestSet();
const src = snapshotFundamentalsSource({ date: set.fundamentalsSnapshot });
const byTicker = new Map((await src.getAll()).map((r) => [r.ticker, r]));
const lookup = (t: string) => byTicker.get(t);

const problems = checkTestSetShape(set);
console.log("id      profile       n  wBeta   gap   mismatch  var  top sector");
for (const c of set.cases) {
  const r = checkCase(c, lookup);
  problems.push(...r.problems.map((p) => `${c.id}: ${p}`));
  console.log(
    `${r.id}  ${r.profile.padEnd(12)} ${String(r.holdings).padStart(2)}  ${r.weightedBeta.toFixed(3)}  ${r.betaGap.toFixed(3)}  ${String(r.expectedMismatch).padEnd(8)}  ${c.variance ? "yes" : "   "}  ${r.topSector} ${(r.topSectorWeight * 100).toFixed(0)}%`,
  );
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nok: ${set.cases.length} cases verified against fundamentals snapshot ${set.fundamentalsSnapshot}`);
