import { PublicKey } from "@solana/web3.js";

import { token2022Balances } from "./holdings";

/**
 * PreStocks: tokenized pre-IPO companies on Solana (prestocks.com). Each token
 * trades around the clock; the company itself doesn't trade at all. PreStocks
 * publishes a mark price for the underlying, so the gap between the token and
 * its mark is the premium (or discount) a buyer pays today. Display only.
 */
const API = "https://prestocks.com/api/prestocks";
const TTL_MS = 60_000;

/** Pyth indexes for the underlying companies. Cover opens on them once our Pyth key is entitled. */
export const PYTH_INDEX: Record<string, string> = {
  OPENAI: "Equity.Index.OPENAI/USD",
  ANTHROPIC: "Equity.Index.ANTHROPIC/USD",
};

export type PreStock = {
  symbol: string;
  name: string;
  mint: string;
  url: string;
  /** PreStocks' mark for the underlying, per token. */
  markPrice: number;
  /** Where the token trades. */
  tokenPrice: number;
  /** tokenPrice / markPrice - 1: positive is a premium over the mark. */
  gap: number;
  markValuation: number;
  impliedValuation: number;
  supply: number;
  pythIndex: string | null;
};

type ApiToken = {
  name: string;
  symbol: string;
  external_url: string;
  contract_address: string;
  markPrice: number;
  markValuation: number;
  tokenPrice: number;
  impliedValuation: number;
  supply: number;
};

let cache: { at: number; tokens: PreStock[] } | null = null;

export async function preStocks(): Promise<PreStock[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.tokens;
  const res = await fetch(API, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PreStocks returned ${res.status}`);
  const tokens = ((await res.json()) as ApiToken[])
    .filter((t) => t.markPrice > 0 && t.tokenPrice > 0)
    .map((t) => ({
      symbol: t.symbol,
      name: t.name.replace(/ PreStocks$/, ""),
      mint: t.contract_address,
      url: t.external_url,
      markPrice: t.markPrice,
      tokenPrice: t.tokenPrice,
      gap: t.tokenPrice / t.markPrice - 1,
      markValuation: t.markValuation,
      impliedValuation: t.impliedValuation,
      supply: t.supply,
      pythIndex: PYTH_INDEX[t.symbol] ?? null,
    }))
    .sort((a, b) => b.markValuation - a.markValuation);
  cache = { at: Date.now(), tokens };
  return tokens;
}

export type PreStockHolding = { symbol: string; amount: number };

/** The PreStocks tokens `owner` holds on mainnet. Read-only. */
export async function preStockHoldings(owner: PublicKey, tokens: PreStock[]): Promise<PreStockHolding[]> {
  const balances = await token2022Balances(owner, new Set(tokens.map((t) => t.mint)));
  return tokens.flatMap((t) => (balances.has(t.mint) ? [{ symbol: t.symbol, amount: balances.get(t.mint)! }] : []));
}
