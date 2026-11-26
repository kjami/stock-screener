import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinnhubClient, FinnhubError, type FinnhubNewsItem } from "../src/data/finnhub.ts";
import { liveFundamentalsSource, snapshotFundamentalsSource, toFundamentalsRow } from "../src/data/fundamentals.ts";
import { companyMatchers, isAboutCompany, liveNewsSource, newsWindow, selectTopNews } from "../src/data/news.ts";
import type { UniverseMember } from "../src/data/universe.ts";

const jnj: UniverseMember = { ticker: "JNJ", name: "Johnson & Johnson", sector: "Health Care" };
const apple: UniverseMember = { ticker: "AAPL", name: "Apple Inc.", sector: "Information Technology" };

describe("toFundamentalsRow", () => {
  const metric = { metric: { beta: 0.17, dividendYieldIndicatedAnnual: 3.12, currentDividendYieldTTM: 1.92, revenueGrowthTTMYoy: 7.8, pfcfShareTTM: 32.245 } };

  it("maps Finnhub fields, using indicated yield and deriving FCF from market cap / P-FCF", () => {
    const r = toFundamentalsRow(jnj, metric, { marketCapitalization: 500_000 });
    expect(r).toEqual({
      ok: true,
      overrides: [],
      row: { ticker: "JNJ", name: "Johnson & Johnson", sector: "Health Care", beta: 0.17, dividendYieldPct: 3.12, revenueGrowthPct: 7.8, freeCashFlowUsd: Math.round(500_000e6 / 32.245) },
    });
  });

  it("swaps an implausible bank TTM revenue growth for the 3-year rate and records it", () => {
    const jpm: UniverseMember = { ticker: "JPM", name: "JPMorgan Chase", sector: "Financials" };
    const r = toFundamentalsRow(jpm, { metric: { ...metric.metric, revenueGrowthTTMYoy: 108.98, revenueGrowth3Y: 3.36 } }, { marketCapitalization: 1 });
    expect(r.ok && r.row.revenueGrowthPct).toBe(3.36);
    expect(r.ok && r.overrides).toEqual([expect.objectContaining({ ticker: "JPM", field: "revenueGrowthPct", original: 108.98, used: 3.36 })]);
  });

  it("does not override high growth outside Financials", () => {
    const mu: UniverseMember = { ticker: "MU", name: "Micron Technology", sector: "Information Technology" };
    const r = toFundamentalsRow(mu, { metric: { ...metric.metric, revenueGrowthTTMYoy: 256.3, revenueGrowth3Y: 20 } }, { marketCapitalization: 1 });
    expect(r.ok && r.row.revenueGrowthPct).toBe(256.3);
  });

  it("treats a missing dividend yield as no dividend", () => {
    const { dividendYieldIndicatedAnnual: _, ...m } = metric.metric;
    const r = toFundamentalsRow(jnj, { metric: m }, { marketCapitalization: 1 });
    expect(r.ok && r.row.dividendYieldPct).toBe(0);
  });

  it("keeps negative FCF negative", () => {
    const r = toFundamentalsRow(jnj, { metric: { ...metric.metric, pfcfShareTTM: -10 } }, { marketCapitalization: 1000 });
    expect(r.ok && r.row.freeCashFlowUsd).toBe(-100_000_000);
  });

  it("drops the ticker with a reason when required fields are missing", () => {
    expect(toFundamentalsRow(jnj, { metric: { beta: 1 } }, {})).toEqual({
      ok: false,
      reason: "missing revenueGrowthTTMYoy, pfcfShareTTM, marketCapitalization",
    });
  });
});

const news = (id: number, datetime: number, headline: string, summary = ""): FinnhubNewsItem =>
  ({ category: "company", datetime, headline, id, image: "", related: "AAPL", source: "Test", summary, url: `https://x.test/${id}` });

describe("news filtering", () => {
  it("matches company name, aliases and upper-case ticker words, not substrings", () => {
    const m = companyMatchers(apple);
    expect(isAboutCompany({ headline: "Apple unveils chip", summary: "" }, m)).toBe(true);
    expect(isAboutCompany({ headline: "Why $AAPL fell", summary: "" }, m)).toBe(true);
    expect(isAboutCompany({ headline: "Pineapple prices rise", summary: "" }, m)).toBe(false);
    expect(isAboutCompany({ headline: "Dow futures slip", summary: "markets wobble" }, m)).toBe(false);
    expect(isAboutCompany({ headline: "Search giant results", summary: "" }, companyMatchers({ ticker: "GOOGL", name: "Alphabet Inc. (Class A)", sector: "Communication Services" }))).toBe(false);
    expect(isAboutCompany({ headline: "Google cloud deal", summary: "" }, companyMatchers({ ticker: "GOOGL", name: "Alphabet Inc. (Class A)", sector: "Communication Services" }))).toBe(true);
  });

  it("does not ticker-match one-letter tickers", () => {
    const citi: UniverseMember = { ticker: "C", name: "Citigroup", sector: "Financials" };
    expect(isAboutCompany({ headline: "Plan C for the Fed", summary: "" }, companyMatchers(citi))).toBe(false);
    expect(isAboutCompany({ headline: "Citigroup beats", summary: "" }, companyMatchers(citi))).toBe(true);
  });

  it("ranks headline mentions first, newest first, dedupes, takes top k", () => {
    const raw = [
      news(1, 100, "Market wrap", "Apple was mentioned"),
      news(2, 50, "Apple old story"),
      news(3, 90, "Apple newer story"),
      news(4, 95, "APPLE NEWER STORY "),
      news(5, 99, "Unrelated"),
    ];
    const top = selectTopNews(apple, raw, 3);
    expect(top.map((n) => n.newsId)).toEqual(["AAPL-4", "AAPL-2", "AAPL-1"]);
    expect(top[0]).toMatchObject({ ticker: "AAPL", publishedAt: new Date(95_000).toISOString(), url: "https://x.test/4" });
  });

  it("computes a 30-day window ending on the as-of date", () => {
    expect(newsWindow("2026-11-25")).toEqual({ from: "2026-10-26", to: "2026-11-25" });
  });
});

describe("FinnhubClient", () => {
  it("sends the key in a header, not the URL, and retries 429", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const responses = [new Response("", { status: 429 }), new Response(JSON.stringify({ metric: { beta: 1 } }), { status: 200 })];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const client = new FinnhubClient({ apiKey: "secret", fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    expect(await client.metric("AAPL")).toEqual({ metric: { beta: 1 } });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).not.toContain("secret");
    expect(calls[0]!.headers["X-Finnhub-Token"]).toBe("secret");
  });

  it("throws on a non-retryable status", async () => {
    const fetchImpl = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    const client = new FinnhubClient({ apiKey: "k", fetchImpl, sleep: async () => {}, minIntervalMs: 0 });
    await expect(client.profile("AAPL")).rejects.toBeInstanceOf(FinnhubError);
  });
});

describe("sources", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "screener-data-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const fakeClient = (overrides: Partial<FinnhubClient> = {}) =>
    ({
      metric: vi.fn(async () => ({ metric: { beta: 0.5, dividendYieldIndicatedAnnual: 3, revenueGrowthTTMYoy: 4, pfcfShareTTM: 20 } })),
      profile: vi.fn(async () => ({ marketCapitalization: 1000 })),
      companyNews: vi.fn(async () => [news(7, 10, "Johnson & Johnson raises dividend")]),
      ...overrides,
    }) as unknown as FinnhubClient;

  it("live fundamentals fetch once per day, then read the dated file; snapshot reads it back", async () => {
    const client = fakeClient();
    const live = liveFundamentalsSource({ client, members: [jnj], dir, today: () => "2026-11-25" });
    expect((await live.get("JNJ"))?.beta).toBe(0.5);
    expect(await live.asOf()).toBe("2026-11-25");
    const again = liveFundamentalsSource({ client, members: [jnj], dir, today: () => "2026-11-25" });
    await again.getAll();
    expect(client.metric).toHaveBeenCalledTimes(1);

    const snap = snapshotFundamentalsSource({ dir });
    expect(snap.mode).toBe("snapshot");
    expect((await snap.getAll()).map((r) => r.ticker)).toEqual(["JNJ"]);
    expect(await snap.get("NOPE")).toBeUndefined();
  });

  it("snapshot source fails clearly when there is no snapshot", async () => {
    await expect(snapshotFundamentalsSource({ dir }).getAll()).rejects.toThrow(/no fundamentals snapshot/);
  });

  it("live news caches per ticker per day and returns [] on failure", async () => {
    const client = fakeClient();
    const src = liveNewsSource({ client, members: [jnj], cacheDir: dir, today: () => "2026-11-25" });
    expect((await src.getTopNews("JNJ")).map((n) => n.newsId)).toEqual(["JNJ-7"]);
    await src.getTopNews("JNJ");
    expect(client.companyNews).toHaveBeenCalledTimes(1);
    expect(await src.getTopNews("NOT-IN-UNIVERSE")).toEqual([]);

    const errors: string[] = [];
    const failing = liveNewsSource({
      client: fakeClient({ companyNews: vi.fn(async () => { throw new Error("boom"); }) as never }),
      members: [jnj], cacheDir: join(dir, "b"), today: () => "2026-11-25", onError: (t) => errors.push(t),
    });
    expect(await failing.getTopNews("JNJ")).toEqual([]);
    expect(errors).toEqual(["JNJ"]);
  });
});
