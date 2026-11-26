/**
 * One structured LLM call, logged. S0, S1, the S3 merge step and the judge
 * all go through here, so every call is captured the same way.
 *
 * Uses AI SDK 7's `generateText` + `Output.object` (generateObject is
 * deprecated in v7).
 */
import { generateText, Output, type LanguageModel } from "ai";
import type { z } from "zod";
import { costUsd } from "./config.ts";
import type { RunLogger } from "./log.ts";

export interface StructuredCall<S extends z.ZodType> {
  model: LanguageModel;
  schema: S;
  system?: string;
  prompt: string;
  logger: RunLogger;
  caseId: string;
  actor?: string;
  temperature?: number;
}

export interface StructuredResult<T> {
  output: T;
  tokens: { input: number; output: number };
  costUsd: number | null;
  ms: number;
}

const modelIdOf = (m: LanguageModel) => (typeof m === "string" ? m : m.modelId);

export async function callStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<StructuredResult<z.infer<S>>> {
  const name = modelIdOf(call.model);
  const input = { system: call.system, prompt: call.prompt };
  const t0 = performance.now();
  try {
    const result = await generateText({
      model: call.model,
      system: call.system,
      prompt: call.prompt,
      temperature: call.temperature,
      output: Output.object({ schema: call.schema }),
    });
    const ms = Math.round(performance.now() - t0);
    const tokens = { input: result.totalUsage.inputTokens ?? 0, output: result.totalUsage.outputTokens ?? 0 };
    const cost = costUsd(name, tokens.input, tokens.output);
    call.logger.log({ caseId: call.caseId, kind: "llm", name, actor: call.actor, input, output: result.output, tokens, costUsd: cost, ms });
    return { output: result.output as z.infer<S>, tokens, costUsd: cost, ms };
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    call.logger.log({ caseId: call.caseId, kind: "llm", name, actor: call.actor, input, output: null, error: message, ms });
    throw err;
  }
}
