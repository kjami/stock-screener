/**
 * JSONL step logger. Every LLM call and tool call becomes one line in
 * runs/<runId>/steps.jsonl. These traces drive the cost numbers, the
 * failure analysis, and the replay of live runs.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type SystemId = "s0" | "s1" | "s2" | "s3" | "judge" | "smoke";

export interface StepRecord {
  runId: string;
  system: SystemId;
  caseId: string;
  step: number;
  kind: "llm" | "tool";
  /** Model id for LLM calls, tool name for tool calls. */
  name: string;
  /** Role or sub-agent that made the call, e.g. "generator", "screener". */
  actor?: string;
  input: unknown;
  output: unknown;
  error?: string;
  tokens?: { input: number; output: number };
  costUsd?: number | null;
  ms: number;
  ts: string;
}

export type StepInput = Omit<StepRecord, "runId" | "system" | "ts" | "step"> & { step?: number };

export interface RunLogger {
  readonly runId: string;
  readonly system: SystemId;
  readonly path: string;
  /** Appends one step. `step` auto-increments per case when omitted. */
  log(entry: StepInput): StepRecord;
}

/** Sortable, readable run id: 2026-11-25T21-52-03Z-s0-1a2b3c */
export function newRunId(system: SystemId, now = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  return `${stamp}-${system}-${randomUUID().slice(0, 6)}`;
}

export function createRunLogger(opts: { system: SystemId; runId?: string; runsDir?: string }): RunLogger {
  const runId = opts.runId ?? newRunId(opts.system);
  const dir = join(opts.runsDir ?? "runs", runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "steps.jsonl");
  const nextStep = new Map<string, number>();

  return {
    runId,
    system: opts.system,
    path,
    log(entry) {
      const step = entry.step ?? nextStep.get(entry.caseId) ?? 0;
      nextStep.set(entry.caseId, step + 1);
      const record: StepRecord = { runId, system: opts.system, ...entry, step, ts: new Date().toISOString() };
      appendFileSync(path, JSON.stringify(record) + "\n");
      return record;
    },
  };
}
