import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callStructured } from "../src/llm.ts";
import { createRunLogger, newRunId, type StepRecord } from "../src/log.ts";
import { Output } from "../src/schemas/index.ts";
import { createMockModel, MOCK_OUTPUT } from "../src/testing/mock-model.ts";
import { validOutput } from "./fixtures.ts";

let runsDir: string;
beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), "screener-runs-")); });
afterEach(() => rmSync(runsDir, { recursive: true, force: true }));

const readSteps = (path: string): StepRecord[] =>
  readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as StepRecord);

describe("newRunId", () => {
  it("is sortable and names the system", () => {
    expect(newRunId("s1", new Date("2026-11-25T21:52:03.123Z"))).toMatch(/^2026-11-25T21-52-03Z-s1-[0-9a-f]{6}$/);
  });
});

describe("createRunLogger", () => {
  it("writes one JSON line per step and numbers steps per case", () => {
    const logger = createRunLogger({ system: "s2", runsDir });
    logger.log({ caseId: "c1", kind: "tool", name: "getExposure", input: {}, output: {}, ms: 1 });
    logger.log({ caseId: "c2", kind: "tool", name: "getNews", input: {}, output: {}, ms: 1 });
    logger.log({ caseId: "c1", kind: "llm", name: "m", input: {}, output: {}, ms: 1 });
    const steps = readSteps(logger.path);
    expect(steps.map((s) => [s.caseId, s.step])).toEqual([["c1", 0], ["c2", 0], ["c1", 1]]);
    expect(steps[0]).toMatchObject({ runId: logger.runId, system: "s2" });
  });
});

describe("callStructured", () => {
  it("returns schema-valid output and logs tokens, cost and latency", async () => {
    const logger = createRunLogger({ system: "smoke", runsDir });
    const model = createMockModel({ response: validOutput, inputTokens: 1234, outputTokens: 567 });
    const res = await callStructured({ model, schema: Output, prompt: "hello", logger, caseId: "smoke-1", actor: "generator" });

    expect(Output.parse(res.output)).toEqual(validOutput);
    expect(res.tokens).toEqual({ input: 1234, output: 567 });
    expect(res.costUsd).toBe(0); // mock-generator is priced at 0

    const [step] = readSteps(logger.path);
    expect(step).toMatchObject({ kind: "llm", name: "mock-generator", actor: "generator", caseId: "smoke-1", tokens: { input: 1234, output: 567 } });
    expect(step?.input).toEqual({ prompt: "hello" });
    expect(step?.output).toEqual(validOutput);
  });

  it("the default mock response is schema-valid", async () => {
    const logger = createRunLogger({ system: "smoke", runsDir });
    const res = await callStructured({ model: createMockModel(), schema: Output, prompt: "x", logger, caseId: "c" });
    expect(res.output).toEqual(MOCK_OUTPUT);
  });

  it("logs and rethrows when the model's JSON fails the schema", async () => {
    const logger = createRunLogger({ system: "smoke", runsDir });
    const model = createMockModel({ response: { recommendations: "not-an-array" } });
    await expect(callStructured({ model, schema: Output, prompt: "x", logger, caseId: "bad" })).rejects.toThrow();
    const [step] = readSteps(logger.path);
    expect(step?.error).toBeTruthy();
    expect(step?.output).toBeNull();
  });

  it("logs and rethrows on malformed JSON", async () => {
    const logger = createRunLogger({ system: "smoke", runsDir });
    const model = createMockModel({ rawText: "{not json" });
    await expect(callStructured({ model, schema: Output, prompt: "x", logger, caseId: "bad" })).rejects.toThrow();
    expect(readSteps(logger.path)[0]?.error).toBeTruthy();
  });

  it("reports cost as null for an unpriced model", async () => {
    const logger = createRunLogger({ system: "smoke", runsDir });
    const res = await callStructured({ model: createMockModel({ modelId: "gpt-5.4" }), schema: Output, prompt: "x", logger, caseId: "c" });
    expect(res.costUsd).toBeNull();
  });
});
