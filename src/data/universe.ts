/**
 * The frozen S&P 100 universe: ticker, company name and GICS sector.
 * Written once by scripts/freeze-universe.ts and committed; every system
 * and metric reads it from here.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { Ticker } from "../schemas/index.ts";

export const GICS_SECTORS = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
] as const;
export const GicsSector = z.enum(GICS_SECTORS);
export type GicsSector = z.infer<typeof GicsSector>;

export const UniverseMember = z.object({ ticker: Ticker, name: z.string().min(1), sector: GicsSector });
export type UniverseMember = z.infer<typeof UniverseMember>;

export const Universe = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.object({ url: z.string(), revisionId: z.number().int() }),
  /** Constituents left out on purpose, with the reason (e.g. a duplicate share class). */
  excluded: z.array(z.object({ ticker: Ticker, reason: z.string() })),
  members: z.array(UniverseMember).min(90),
});
export type Universe = z.infer<typeof Universe>;

export const UNIVERSE_PATH = "data/universe/sp100.json";

export function loadUniverse(path = UNIVERSE_PATH): Universe {
  return Universe.parse(JSON.parse(readFileSync(path, "utf8")));
}
