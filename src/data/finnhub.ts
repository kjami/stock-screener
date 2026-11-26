/**
 * Minimal Finnhub REST client: the three free-plan endpoints this project
 * uses, throttled under the 60 calls/minute limit, with retry on 429/5xx.
 */

export interface FinnhubMetricResponse {
  symbol?: string;
  metric?: Record<string, number | string | null | undefined>;
}

export interface FinnhubProfile {
  ticker?: string;
  name?: string;
  /** Millions of USD. */
  marketCapitalization?: number;
  finnhubIndustry?: string;
}

export interface FinnhubNewsItem {
  category: string;
  /** Unix seconds. */
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface FinnhubClientOptions {
  apiKey: string;
  /** Minimum gap between requests. 1100 ms keeps under 60/min with margin. */
  minIntervalMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class FinnhubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "FinnhubError";
  }
}

const BASE = "https://finnhub.io/api/v1";

export class FinnhubClient {
  private readonly apiKey: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;

  constructor(opts: FinnhubClientOptions) {
    this.apiKey = opts.apiKey;
    this.minIntervalMs = opts.minIntervalMs ?? 1100;
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  metric(symbol: string): Promise<FinnhubMetricResponse> {
    return this.get("/stock/metric", { symbol, metric: "all" });
  }

  profile(symbol: string): Promise<FinnhubProfile> {
    return this.get("/stock/profile2", { symbol });
  }

  /** `from` / `to` are YYYY-MM-DD, inclusive. */
  companyNews(symbol: string, from: string, to: string): Promise<FinnhubNewsItem[]> {
    return this.get("/company-news", { symbol, from, to });
  }

  /** Requests run one at a time, spaced by minIntervalMs. */
  private get<T>(path: string, params: Record<string, string>): Promise<T> {
    const run = this.queue.then(() => this.request<T>(path, params));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${BASE}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCall + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastCall = Date.now();
      // Key goes in a header, never in the URL, so it can't leak into logs.
      const res = await this.fetchImpl(url, { headers: { "X-Finnhub-Token": this.apiKey } });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) {
        throw new FinnhubError(`Finnhub ${path} ${params.symbol ?? ""} → HTTP ${res.status}`, res.status);
      }
      await this.sleep(2000 * 2 ** attempt);
    }
  }
}
