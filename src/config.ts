/**
 * Runtime configuration, read from the environment (.env) and validated with Zod.
 *
 * `loadConfig(env)` is pure: tests pass their own env object, and nothing here
 * reads `.env` from disk. Entry points call `loadConfigFromProcess()`, which
 * loads `.env` first.
 */
import { z } from "zod";

// ---------------------------------------------------------------- providers and roles

export const PROVIDERS = ["openai", "anthropic", "google", "openai-compatible", "mock"] as const;
export const ProviderName = z.enum(PROVIDERS);
export type ProviderName = z.infer<typeof ProviderName>;

/** Providers that can serve embeddings for the 10-K index. */
export const EMBEDDING_PROVIDERS = ["openai", "google", "openai-compatible", "mock"] as const satisfies readonly ProviderName[];

/** Which model a call uses. The judge must be stronger than every generator. */
export const ROLES = ["generator", "orchestrator", "subagent", "judge"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Default model per provider and role; each can be overridden with MODEL_<ROLE>.
 * openai-compatible has no defaults: its models depend on the endpoint.
 */
export const DEFAULT_MODELS: Record<Exclude<ProviderName, "openai-compatible">, Record<Role, string>> = {
  openai: { generator: "gpt-5.4", orchestrator: "gpt-5.4", subagent: "gpt-5.4-mini", judge: "gpt-5.5" },
  anthropic: { generator: "claude-sonnet-5-5", orchestrator: "claude-sonnet-5-5", subagent: "claude-haiku-5-5", judge: "claude-opus-5-5" },
  google: { generator: "gemini-3.5-flash", orchestrator: "gemini-pro-latest", subagent: "gemini-3.5-flash-lite", judge: "gemini-pro-latest" },
  mock: { generator: "mock-generator", orchestrator: "mock-orchestrator", subagent: "mock-subagent", judge: "mock-judge" },
};

export const DEFAULT_EMBEDDING_MODELS: Record<(typeof EMBEDDING_PROVIDERS)[number], string | undefined> = {
  openai: "text-embedding-3-small",
  google: "gemini-embedding-001",
  "openai-compatible": undefined,
  mock: "mock-embedding",
};

/**
 * USD per 1M tokens. Fill these in from each provider's pricing page before
 * reporting costs. A model missing here reports its cost as unknown (null),
 * never as $0, so cost comparisons can't be silently wrong.
 */
export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "mock-generator": { input: 0, output: 0 },
  "mock-orchestrator": { input: 0, output: 0 },
  "mock-subagent": { input: 0, output: 0 },
  "mock-judge": { input: 0, output: 0 },
};

/** Cost in USD, or null when the model has no price entry. */
export function costUsd(modelId: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICES_PER_MTOK[modelId];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ---------------------------------------------------------------- data modes

export const DataMode = z.enum(["snapshot", "live"]);
export type DataMode = z.infer<typeof DataMode>;

// ---------------------------------------------------------------- env schema

/** Empty strings in .env mean "not set". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(blank, s.optional());
const optLower = <T extends z.ZodType>(s: T) => z.preprocess((v) => lower(blank(v)), s.optional());

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const EnvSchema = z.object({
  API_PROVIDER: z.preprocess((v) => lower(blank(v)), ProviderName),
  API_KEY: opt(z.string()),
  API_BASE_URL: opt(z.url()),
  MODEL_GENERATOR: opt(z.string()),
  MODEL_ORCHESTRATOR: opt(z.string()),
  MODEL_SUBAGENT: opt(z.string()),
  MODEL_JUDGE: opt(z.string()),

  EMBEDDING_PROVIDER: optLower(ProviderName),
  EMBEDDING_API_KEY: opt(z.string()),
  EMBEDDING_MODEL: opt(z.string()),

  DATA_MODE: z.preprocess((v) => lower(blank(v)) ?? "snapshot", DataMode),
  FUNDAMENTALS_MODE: optLower(DataMode),
  NEWS_MODE: optLower(DataMode),
  SNAPSHOT_DATE: opt(IsoDate),
  FUNDAMENTALS_API_KEY: opt(z.string()),
  NEWS_API_KEY: opt(z.string()),

  MAX_STEPS: z.preprocess((v) => blank(v) ?? "15", z.coerce.number().int().positive()),
  MAX_TOKENS_PER_CASE: z.preprocess((v) => blank(v) ?? "200000", z.coerce.number().int().positive()),
});

// ---------------------------------------------------------------- resolved config

export interface Config {
  provider: ProviderName;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  models: Record<Role, string>;
  embedding: { provider: ProviderName; apiKey: string | undefined; baseUrl: string | undefined; model: string };
  data: {
    fundamentalsMode: DataMode;
    newsMode: DataMode;
    snapshotDate: string | undefined;
    fundamentalsApiKey: string | undefined;
    newsApiKey: string | undefined;
  };
  caps: { maxSteps: number; maxTokensPerCase: number };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(env)"}: ${i.message}`);
    throw new ConfigError(`Invalid configuration in .env:\n${lines.join("\n")}\nSee .env.example.`);
  }
  const e = parsed.data;
  const problems: string[] = [];

  if (e.API_PROVIDER !== "mock" && !e.API_KEY) problems.push(`API_KEY is required when API_PROVIDER=${e.API_PROVIDER}`);
  if (e.API_PROVIDER === "openai-compatible" && !e.API_BASE_URL) problems.push("API_BASE_URL is required when API_PROVIDER=openai-compatible");

  const overrides: Partial<Record<Role, string>> = {
    generator: e.MODEL_GENERATOR,
    orchestrator: e.MODEL_ORCHESTRATOR,
    subagent: e.MODEL_SUBAGENT,
    judge: e.MODEL_JUDGE,
  };
  const defaults = e.API_PROVIDER === "openai-compatible" ? undefined : DEFAULT_MODELS[e.API_PROVIDER];
  const models = {} as Record<Role, string>;
  for (const role of ROLES) {
    const id = overrides[role] ?? defaults?.[role];
    if (!id) problems.push(`MODEL_${role.toUpperCase()} is required when API_PROVIDER=openai-compatible`);
    models[role] = id ?? "";
  }

  // Embeddings default to the main provider; Anthropic has none, so it must be set explicitly.
  const embProvider = e.EMBEDDING_PROVIDER ?? e.API_PROVIDER;
  const embIsMain = !e.EMBEDDING_PROVIDER || e.EMBEDDING_PROVIDER === e.API_PROVIDER;
  const embKey = e.EMBEDDING_API_KEY ?? (embIsMain ? e.API_KEY : undefined);
  let embModel = e.EMBEDDING_MODEL;
  if (!(EMBEDDING_PROVIDERS as readonly string[]).includes(embProvider)) {
    problems.push(`${embProvider} has no embedding model; set EMBEDDING_PROVIDER (e.g. openai) and EMBEDDING_API_KEY`);
  } else {
    embModel ??= DEFAULT_EMBEDDING_MODELS[embProvider as (typeof EMBEDDING_PROVIDERS)[number]];
    if (!embModel) problems.push(`EMBEDDING_MODEL is required when the embedding provider is ${embProvider}`);
    if (embProvider !== "mock" && !embKey) problems.push("EMBEDDING_API_KEY is required (or use the main provider's key)");
  }

  if (problems.length) {
    throw new ConfigError(`Invalid configuration in .env:\n${problems.map((p) => `  ${p}`).join("\n")}\nSee .env.example.`);
  }

  return {
    provider: e.API_PROVIDER,
    apiKey: e.API_KEY,
    baseUrl: e.API_BASE_URL,
    models,
    embedding: { provider: embProvider, apiKey: embKey, baseUrl: embIsMain ? e.API_BASE_URL : undefined, model: embModel ?? "" },
    data: {
      fundamentalsMode: e.FUNDAMENTALS_MODE ?? e.DATA_MODE,
      newsMode: e.NEWS_MODE ?? e.DATA_MODE,
      snapshotDate: e.SNAPSHOT_DATE,
      fundamentalsApiKey: e.FUNDAMENTALS_API_KEY,
      newsApiKey: e.NEWS_API_KEY,
    },
    caps: { maxSteps: e.MAX_STEPS, maxTokensPerCase: e.MAX_TOKENS_PER_CASE },
  };
}

/** Evals always read the snapshot, whatever .env says. */
export function forEval(config: Config): Config {
  return { ...config, data: { ...config.data, fundamentalsMode: "snapshot", newsMode: "snapshot" } };
}

/** Loads .env (if present) into process.env, then validates. For entry points only. */
export async function loadConfigFromProcess(): Promise<Config> {
  const { config } = await import("dotenv");
  config({ quiet: true });
  return loadConfig(process.env);
}
