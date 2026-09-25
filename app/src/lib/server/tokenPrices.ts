import { STOCKS } from "../stocks";

/** Below this much on-chain liquidity a token's last trade isn't a price worth showing. */
const MIN_LIQUIDITY_USD = 10_000;

export type TokenPrice = { mint: string; price: number; liquidity: number; source: "jupiter" };

type JupiterPrice = { usdPrice?: number; liquidity?: number };

/**
 * Where tokenized stocks trade on Solana right now, from Jupiter's price API.
 * Display only: settlement never reads it. Used until our Pyth key is entitled
 * to the Crypto.<SYM>X feeds, which the client prefers when present.
 */
export async function tokenizedPrices(): Promise<Record<string, TokenPrice>> {
  const mints = STOCKS.flatMap((s) => s.tokenized.map((t) => t.mint));
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`, {
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Jupiter price API returned ${res.status}`);
  const body = (await res.json()) as Record<string, JupiterPrice | null>;
  const out: Record<string, TokenPrice> = {};
  for (const mint of mints) {
    const p = body[mint];
    if (!p?.usdPrice || !(p.liquidity! >= MIN_LIQUIDITY_USD)) continue;
    out[mint] = { mint, price: p.usdPrice, liquidity: p.liquidity!, source: "jupiter" };
  }
  return out;
}
