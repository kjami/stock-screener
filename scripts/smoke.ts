/**
 * Smoke test: one structured call through the configured provider, validated
 * against the Output schema and written to runs/<runId>/steps.jsonl.
 *
 *   pnpm smoke                      # uses API_PROVIDER from .env
 *   API_PROVIDER=mock pnpm smoke    # no key, no network
 */
import { loadConfigFromProcess } from "../src/config.ts";
import { callStructured } from "../src/llm.ts";
import { createRunLogger } from "../src/log.ts";
import { getLanguageModel } from "../src/providers.ts";
import { Output } from "../src/schemas/index.ts";

const config = await loadConfigFromProcess();
const model = getLanguageModel(config, "generator");
const logger = createRunLogger({ system: "smoke" });

console.log(`provider=${config.provider} model=${config.models.generator} run=${logger.runId}`);

const res = await callStructured({
  model,
  schema: Output,
  logger,
  caseId: "smoke-1",
  actor: "generator",
  system: "You are a test fixture. Reply only with JSON matching the schema.",
  prompt:
    "Return exactly one recommendation for ticker KO with all keyMetrics null, one citation " +
    "{chunkId: 'SMOKE', ticker: 'KO', section: '1A'}, newsSentiment null, short placeholder strings " +
    "elsewhere, and profileGap.detected false. This is a connectivity test, not advice.",
});

Output.parse(res.output);
console.log(`ok: schema-valid output, ${res.tokens.input} in / ${res.tokens.output} out tokens, ${res.ms} ms, cost ${res.costUsd ?? "unknown (no price entry)"}`);
console.log(`log: ${logger.path}`);
