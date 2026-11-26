/**
 * A language model that never calls an API. Used by tests and by
 * API_PROVIDER=mock, so the harness can run end to end without a key.
 *
 * By default it answers with MOCK_OUTPUT, a schema-valid Output that is
 * clearly marked as mock data. Tests can pass their own response.
 */
import { MockLanguageModelV4 } from "ai/test";
import type { Output } from "../schemas/index.ts";

export const MOCK_OUTPUT: Output = {
  recommendations: [
    {
      ticker: "KO",
      keyMetrics: { beta: null, dividendYieldPct: null, revenueGrowthPct: null, freeCashFlowUsd: null, sector: null },
      rationale: "MOCK OUTPUT: canned response from the mock provider, not a real recommendation.",
      citations: [{ chunkId: "MOCK-CHUNK", ticker: "KO", section: "1A" }],
      mainRisk: "MOCK OUTPUT",
      fitEffect: { sectorConcentration: "MOCK OUTPUT", overlap: "MOCK OUTPUT", gapEffect: "MOCK OUTPUT" },
      newsSentiment: { label: "unavailable", reason: "MOCK OUTPUT", citations: [] },
    },
  ],
  profileGap: { detected: false, explanation: "MOCK OUTPUT" },
};

export interface MockModelOptions {
  modelId?: string;
  /** Object to return as the model's JSON text. Defaults to MOCK_OUTPUT. */
  response?: unknown;
  /** Raw text to return instead of `response` (e.g. to test invalid JSON). */
  rawText?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function createMockModel(opts: MockModelOptions = {}): MockLanguageModelV4 {
  const text = opts.rawText ?? JSON.stringify(opts.response ?? MOCK_OUTPUT);
  const inputTokens = opts.inputTokens ?? 100;
  const outputTokens = opts.outputTokens ?? 200;
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: opts.modelId ?? "mock-generator",
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}
