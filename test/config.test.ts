import { describe, expect, it } from "vitest";
import { ConfigError, costUsd, forEval, loadConfig } from "../src/config.ts";

const base = { API_PROVIDER: "openai", API_KEY: "sk-test" };

describe("loadConfig", () => {
  it("accepts the provider name in any case", () => {
    expect(loadConfig({ ...base, API_PROVIDER: "OPENAI" }).provider).toBe("openai");
  });

  it("uses provider defaults per role and honours overrides", () => {
    const c = loadConfig({ ...base, MODEL_JUDGE: "gpt-custom" });
    expect(c.models.generator).toBe("gpt-5.4");
    expect(c.models.subagent).toBe("gpt-5.4-mini");
    expect(c.models.judge).toBe("gpt-custom");
  });

  it("treats blank .env values as unset", () => {
    const c = loadConfig({ ...base, MODEL_GENERATOR: "", API_BASE_URL: "", DATA_MODE: "", MAX_STEPS: "" });
    expect(c.models.generator).toBe("gpt-5.4");
    expect(c.baseUrl).toBeUndefined();
    expect(c.data.fundamentalsMode).toBe("snapshot");
    expect(c.caps.maxSteps).toBe(15);
  });

  it("requires a key for real providers but not for mock", () => {
    expect(() => loadConfig({ API_PROVIDER: "openai" })).toThrow(/API_KEY is required/);
    expect(loadConfig({ API_PROVIDER: "mock" }).models.generator).toBe("mock-generator");
  });

  it("rejects an unknown provider with a readable message", () => {
    expect(() => loadConfig({ API_PROVIDER: "cohere", API_KEY: "x" })).toThrow(ConfigError);
  });

  it("requires base URL and model ids for openai-compatible", () => {
    expect(() => loadConfig({ API_PROVIDER: "openai-compatible", API_KEY: "x" })).toThrow(/API_BASE_URL[\s\S]*MODEL_GENERATOR/);
    const c = loadConfig({
      API_PROVIDER: "openai-compatible", API_KEY: "x", API_BASE_URL: "https://openrouter.ai/api/v1",
      MODEL_GENERATOR: "a", MODEL_ORCHESTRATOR: "b", MODEL_SUBAGENT: "c", MODEL_JUDGE: "d", EMBEDDING_MODEL: "e",
    });
    expect(c.models.judge).toBe("d");
    expect(c.embedding.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("embeddings default to the main provider and key", () => {
    const c = loadConfig(base);
    expect(c.embedding).toMatchObject({ provider: "openai", apiKey: "sk-test", model: "text-embedding-3-small" });
  });

  it("anthropic needs a separate embedding provider", () => {
    expect(() => loadConfig({ API_PROVIDER: "anthropic", API_KEY: "x" })).toThrow(/no embedding model/);
    const c = loadConfig({ API_PROVIDER: "anthropic", API_KEY: "x", EMBEDDING_PROVIDER: "openai", EMBEDDING_API_KEY: "sk-emb" });
    expect(c.embedding).toMatchObject({ provider: "openai", apiKey: "sk-emb" });
  });

  it("does not reuse the main key for a different embedding provider", () => {
    expect(() => loadConfig({ ...base, EMBEDDING_PROVIDER: "google" })).toThrow(/EMBEDDING_API_KEY/);
  });

  it("per-source data modes override DATA_MODE", () => {
    const c = loadConfig({ ...base, DATA_MODE: "live", NEWS_MODE: "SNAPSHOT" });
    expect(c.data).toMatchObject({ fundamentalsMode: "live", newsMode: "snapshot" });
  });

  it("validates SNAPSHOT_DATE and numeric caps", () => {
    expect(() => loadConfig({ ...base, SNAPSHOT_DATE: "25/11/2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => loadConfig({ ...base, MAX_STEPS: "-1" })).toThrow(ConfigError);
    expect(loadConfig({ ...base, MAX_TOKENS_PER_CASE: "50000" }).caps.maxTokensPerCase).toBe(50000);
  });
});

describe("forEval", () => {
  it("forces snapshot mode for both sources", () => {
    const c = forEval(loadConfig({ ...base, DATA_MODE: "live" }));
    expect(c.data).toMatchObject({ fundamentalsMode: "snapshot", newsMode: "snapshot" });
  });
});

describe("costUsd", () => {
  it("returns null, not 0, for a model with no price entry", () => {
    expect(costUsd("unpriced-model", 1000, 1000)).toBeNull();
    expect(costUsd("mock-generator", 1000, 1000)).toBe(0);
  });
});
