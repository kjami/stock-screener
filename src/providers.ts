/**
 * Turns config into AI SDK model instances. Nothing else in the codebase
 * imports a provider package: switching provider is a .env change only.
 *
 * Embedding models are wired in Increment 3 (10-K index).
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Config, Role } from "./config.ts";
import { createMockModel } from "./testing/mock-model.ts";

export function getLanguageModel(config: Config, role: Role): LanguageModel {
  const modelId = config.models[role];
  const apiKey = config.apiKey;
  switch (config.provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: config.baseUrl })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "google":
      return createGoogle({ apiKey })(modelId);
    case "openai-compatible":
      // loadConfig guarantees baseUrl is set for this provider.
      return createOpenAICompatible({ name: "openai-compatible", baseURL: config.baseUrl!, apiKey })(modelId);
    case "mock":
      return createMockModel({ modelId });
  }
}
