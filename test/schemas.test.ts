import { describe, expect, it } from "vitest";
import { InvestorInput, NewsSentiment, Output, Recommendation, Ticker } from "../src/schemas/index.ts";
import { validInput, validOutput, validRecommendation } from "./fixtures.ts";

describe("Ticker", () => {
  it.each(["AAPL", "BRK.B", "GOOGL", "F"])("accepts %s", (t) => expect(Ticker.safeParse(t).success).toBe(true));
  it.each(["aapl", "", "TOOLONGX", "BRK..B", "1ABC"])("rejects %j", (t) => expect(Ticker.safeParse(t).success).toBe(false));
});

describe("InvestorInput", () => {
  it("accepts a valid input", () => {
    expect(InvestorInput.safeParse(validInput).success).toBe(true);
  });

  it("accepts weights within rounding tolerance", () => {
    const input = { ...validInput, holdings: [{ ticker: "AAPL", weight: 0.333 }, { ticker: "MSFT", weight: 0.333 }, { ticker: "KO", weight: 0.333 }] };
    expect(InvestorInput.safeParse(input).success).toBe(true);
  });

  it("rejects weights that do not sum to 1", () => {
    const input = { ...validInput, holdings: [{ ticker: "AAPL", weight: 0.5 }, { ticker: "MSFT", weight: 0.3 }] };
    const r = InvestorInput.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/sum to 1/);
  });

  it("rejects duplicate holdings", () => {
    const input = { ...validInput, holdings: [{ ticker: "AAPL", weight: 0.5 }, { ticker: "AAPL", weight: 0.5 }] };
    expect(InvestorInput.safeParse(input).error?.issues[0]?.message).toMatch(/duplicate/);
  });

  it("rejects empty and >15 holdings", () => {
    expect(InvestorInput.safeParse({ ...validInput, holdings: [] }).success).toBe(false);
    const many = Array.from({ length: 16 }, (_, i) => ({ ticker: `T${String.fromCharCode(65 + i)}`, weight: 1 / 16 }));
    expect(InvestorInput.safeParse({ ...validInput, holdings: many }).success).toBe(false);
  });

  it("rejects an unknown profile", () => {
    expect(InvestorInput.safeParse({ ...validInput, profile: "yolo" }).success).toBe(false);
  });
});

describe("NewsSentiment", () => {
  it("requires a citation unless unavailable", () => {
    expect(NewsSentiment.safeParse({ label: "positive", reason: "x", citations: [] }).success).toBe(false);
    expect(NewsSentiment.safeParse({ label: "unavailable", reason: "provider down", citations: [] }).success).toBe(true);
  });
});

describe("Recommendation", () => {
  it("accepts a valid recommendation", () => {
    expect(Recommendation.safeParse(validRecommendation).success).toBe(true);
  });

  it("requires at least one filing citation", () => {
    expect(Recommendation.safeParse({ ...validRecommendation, citations: [] }).success).toBe(false);
  });

  it("rejects an unknown 10-K section", () => {
    const bad = { ...validRecommendation, citations: [{ chunkId: "x", ticker: "JNJ", section: "2" }] };
    expect(Recommendation.safeParse(bad).success).toBe(false);
  });

  it("allows null news sentiment and null metrics", () => {
    const rec = {
      ...validRecommendation,
      newsSentiment: null,
      keyMetrics: { beta: null, dividendYieldPct: null, revenueGrowthPct: null, freeCashFlowUsd: null, sector: null },
    };
    expect(Recommendation.safeParse(rec).success).toBe(true);
  });

  it("rejects a missing (undefined) field, since LLM schemas use null not optional", () => {
    const { newsSentiment: _omit, ...rest } = validRecommendation;
    expect(Recommendation.safeParse(rest).success).toBe(false);
  });
});

describe("Output", () => {
  it("accepts a valid output and an empty recommendation list", () => {
    expect(Output.safeParse(validOutput).success).toBe(true);
    expect(Output.safeParse({ ...validOutput, recommendations: [] }).success).toBe(true);
  });

  it("rejects more than 5 recommendations", () => {
    const six = ["JNJ", "KO", "PG", "PEP", "MRK", "VZ"].map((ticker) => ({ ...validRecommendation, ticker }));
    expect(Output.safeParse({ ...validOutput, recommendations: six }).success).toBe(false);
  });

  it("rejects duplicate recommendations", () => {
    const out = { ...validOutput, recommendations: [validRecommendation, validRecommendation] };
    expect(Output.safeParse(out).error?.issues[0]?.message).toMatch(/duplicate/);
  });
});
