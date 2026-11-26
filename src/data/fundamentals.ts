/**
 * Fundamentals from Finnhub's free plan, mapped to FundamentalsRow, plus the
 * snapshot and live FundamentalsSource implementations.
 *
 * Field choices (checked against live responses on 2026-11-25):
 *   beta              metric.beta
 *   dividendYieldPct  metric.dividendYieldIndicatedAnnual (not currentDividendYieldTTM,
 *                     which reads JNJ at 1.92% vs 3.12% and would wrongly fail the
 *                     conservative rule); missing = the company pays no dividend → 0
 *   revenueGrowthPct  metric.revenueGrowthTTMYoy
 *   freeCashFlowUsd   profile.marketCapitalization (USD millions) / metric.pfcfShareTTM;
 *                     the free plan has no dollar FCF field
 *   sector            GICS sector from the frozen universe (Finnhub's industry is not GICS)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DataMode } from "../config.ts";
import type { FinnhubClient, FinnhubMetricResponse, FinnhubProfile } from "./finnhub.ts";
import { FundamentalsSnapshot, type FundamentalsRow, type FundamentalsSource } from "./sources.ts";
import type { UniverseMember } from "./universe.ts";

export const SNAPSHOT_DIR = "data/snapshot";
export const FIELD_MAP = {
  beta: "metric.beta",
  dividendYieldPct: "metric.dividendYieldIndicatedAnnual (missing → 0, no dividend)",
  revenueGrowthPct: "metric.revenueGrowthTTMYoy (Financials > 50% → metric.revenueGrowth3Y, see overrides)",
  freeCashFlowUsd: "profile.marketCapitalization × 1e6 / metric.pfcfShareTTM",
  sector: "universe (GICS)",
} as const;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export interface Override { ticker: string; field: string; original: number; used: number; reason: string }
export type RowResult = { ok: true; row: FundamentalsRow; overrides: Override[] } | { ok: false; reason: string };

/**
 * Bank "revenue" on Finnhub's free plan jumps when the revenue definition
 * changes (JPM, BAC, C, USB, WFC read 70–109% TTM growth on 2026-11-25 while
 * their 3-year rates are 3–8%). For Financials above this TTM growth, the
 * 3-year rate is used instead and the swap is recorded.
 */
export const FINANCIALS_TTM_GROWTH_CEILING = 50;

/** Pure mapping from raw Finnhub responses to a row; testable without network. */
export function toFundamentalsRow(member: UniverseMember, metric: FinnhubMetricResponse, profile: FinnhubProfile): RowResult {
  const m = metric.metric ?? {};
  const beta = num(m.beta);
  const dividendYieldPct = num(m.dividendYieldIndicatedAnnual) ?? 0;
  let revenueGrowthPct = num(m.revenueGrowthTTMYoy);
  const overrides: Override[] = [];
  const growth3y = num(m.revenueGrowth3Y);
  if (member.sector === "Financials" && revenueGrowthPct !== undefined && revenueGrowthPct > FINANCIALS_TTM_GROWTH_CEILING && growth3y !== undefined) {
    overrides.push({
      ticker: member.ticker,
      field: "revenueGrowthPct",
      original: revenueGrowthPct,
      used: growth3y,
      reason: `Financials TTM revenue growth > ${FINANCIALS_TTM_GROWTH_CEILING}% (revenue-definition artifact); used revenueGrowth3Y`,
    });
    revenueGrowthPct = growth3y;
  }
  const pfcf = num(m.pfcfShareTTM);
  const marketCapM = num(profile.marketCapitalization);

  const missing = [
    beta === undefined && "beta",
    revenueGrowthPct === undefined && "revenueGrowthTTMYoy",
    pfcf === undefined && "pfcfShareTTM",
    marketCapM === undefined && "marketCapitalization",
  ].filter(Boolean);
  if (missing.length) return { ok: false, reason: `missing ${missing.join(", ")}` };
  if (pfcf === 0) return { ok: false, reason: "pfcfShareTTM is 0" };

  return {
    ok: true,
    overrides,
    row: {
      ticker: member.ticker,
      name: member.name,
      sector: member.sector,
      beta: beta!,
      dividendYieldPct,
      revenueGrowthPct: revenueGrowthPct!,
      freeCashFlowUsd: Math.round((marketCapM! * 1_000_000) / pfcf!),
    },
  };
}

/** Fetches every universe member (2 calls each) and builds a snapshot. */
export async function fetchFundamentalsSnapshot(
  client: FinnhubClient,
  members: UniverseMember[],
  asOf: string,
  onProgress?: (done: number, total: number, ticker: string) => void,
): Promise<FundamentalsSnapshot> {
  const rows: FundamentalsRow[] = [];
  const dropped: { ticker: string; reason: string }[] = [];
  const overrides: Override[] = [];
  for (const [i, member] of members.entries()) {
    try {
      const [metric, profile] = [await client.metric(member.ticker), await client.profile(member.ticker)];
      const r = toFundamentalsRow(member, metric, profile);
      if (r.ok) {
        rows.push(r.row);
        overrides.push(...r.overrides);
      } else dropped.push({ ticker: member.ticker, reason: r.reason });
    } catch (err) {
      dropped.push({ ticker: member.ticker, reason: err instanceof Error ? err.message : String(err) });
    }
    onProgress?.(i + 1, members.length, member.ticker);
  }
  return FundamentalsSnapshot.parse({ asOf, provider: "finnhub", fieldMap: FIELD_MAP, rows, dropped, overrides });
}

// ---------------------------------------------------------------- files

export const fundamentalsPath = (date: string, dir = SNAPSHOT_DIR) => join(dir, `fundamentals-${date}.json`);

/** Dates of snapshots on disk, newest first. */
export function listSnapshotDates(prefix: "fundamentals" | "news", dir = SNAPSHOT_DIR): string[] {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.json$`);
  return readdirSync(dir).flatMap((f) => re.exec(f)?.[1] ?? []).sort().reverse();
}

export function readFundamentalsSnapshot(path: string): FundamentalsSnapshot {
  return FundamentalsSnapshot.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function writeFundamentalsSnapshot(snapshot: FundamentalsSnapshot, dir = SNAPSHOT_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = fundamentalsPath(snapshot.asOf, dir);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  return path;
}

// ---------------------------------------------------------------- sources

class FileFundamentalsSource implements FundamentalsSource {
  private byTicker?: Map<string, FundamentalsRow>;
  private snapshot?: FundamentalsSnapshot;

  constructor(readonly mode: DataMode, private readonly load: () => Promise<FundamentalsSnapshot>) {}

  private async data() {
    this.snapshot ??= await this.load();
    this.byTicker ??= new Map(this.snapshot.rows.map((r) => [r.ticker, r]));
    return { snapshot: this.snapshot, byTicker: this.byTicker };
  }

  async asOf() { return (await this.data()).snapshot.asOf; }
  async getAll() { return (await this.data()).snapshot.rows; }
  async get(ticker: string) { return (await this.data()).byTicker.get(ticker); }
}

/** Reads a pinned snapshot date, or the newest one on disk. */
export function snapshotFundamentalsSource(opts: { date?: string; dir?: string } = {}): FundamentalsSource {
  return new FileFundamentalsSource("snapshot", async () => {
    const date = opts.date ?? listSnapshotDates("fundamentals", opts.dir)[0];
    if (!date) throw new Error(`no fundamentals snapshot in ${opts.dir ?? SNAPSHOT_DIR}; run pnpm snapshot`);
    return readFundamentalsSnapshot(fundamentalsPath(date, opts.dir));
  });
}

/**
 * Live: uses today's file if it exists, otherwise fetches all members once,
 * writes today's file, and reads it. At most one full refresh a day.
 */
export function liveFundamentalsSource(opts: {
  client: FinnhubClient;
  members: UniverseMember[];
  dir?: string;
  today?: () => string;
}): FundamentalsSource {
  const today = opts.today ?? (() => new Date().toLocaleDateString("en-CA"));
  return new FileFundamentalsSource("live", async () => {
    const date = today();
    const path = fundamentalsPath(date, opts.dir);
    if (existsSync(path)) return readFundamentalsSnapshot(path);
    const snap = await fetchFundamentalsSnapshot(opts.client, opts.members, date);
    writeFundamentalsSnapshot(snap, opts.dir);
    return snap;
  });
}
