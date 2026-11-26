# Profile-Aware Multi-Agent Stock Screener

Given an investor's risk profile and current holdings, recommend up to five S&P 100 stocks that fit the profile, each grounded in cited 10-K text, fundamentals and recent news sentiment. Four systems (S0 closed-book, S1 workflow, S2 single ReAct agent, S3 orchestrator + sub-agents) are compared on the same frozen data and 30-case test set.

Design doc: *Profile-Aware Stock Screener*.

> Educational project, not financial advice.

## Setup

Requires Node 26 (`.nvmrc`) and pnpm.

```bash
nvm use
pnpm install
cp .env.example .env   # then set API_PROVIDER and API_KEY
```

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (always use the mock model; no key or network needed) |
| `pnpm typecheck` | TypeScript check |
| `pnpm smoke` | One structured call through the configured provider, logged to `runs/` |
| `API_PROVIDER=mock pnpm smoke` | Same, with no key |

## Configuration

All settings are in `.env`; see [.env.example](.env.example).

- **Model provider:** `API_PROVIDER` is `openai`, `anthropic`, `google`, `openai-compatible` (needs `API_BASE_URL`) or `mock`. Each role (generator, orchestrator, sub-agent, judge) has a default model that `MODEL_<ROLE>` overrides.
- **Data mode:** `DATA_MODE` is `snapshot` (dated JSON under `data/snapshot/`) or `live`. Evals always use the snapshot.

## Layout

```
src/
  config.ts        env → validated config, model defaults, price table
  providers.ts     config → AI SDK model (the only file that imports provider packages)
  llm.ts           one structured LLM call, logged
  log.ts           JSONL step logger → runs/<runId>/steps.jsonl
  schemas/         Zod contracts: InvestorInput, Output, citations
  data/sources.ts  FundamentalsSource / NewsSource interfaces (snapshot | live)
  testing/         mock model
scripts/smoke.ts
test/
```
