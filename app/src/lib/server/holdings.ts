import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, ParsedAccountData, PublicKey } from "@solana/web3.js";

import { STOCKS } from "../stocks";

/** Tokenized stocks live on mainnet; the markets themselves are on devnet. */
export const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";

export type Holding = {
  /** Underlying ticker, e.g. TSLA. */
  stock: string;
  /** Token symbol, e.g. TSLAx. */
  symbol: string;
  issuer: string;
  mint: string;
  /** Share-equivalents: raw balance scaled by the issuer's UI multiplier. */
  shares: number;
};

const KNOWN = new Map(STOCKS.flatMap((s) => s.tokenized.map((t) => [t.mint, { stock: s.symbol, ...t }])));

type ScaledUiAmountConfig = {
  multiplier: string;
  newMultiplier: string;
  newMultiplierEffectiveTimestamp: number;
};

/**
 * xStocks and Ondo pass dividends through by raising a Token-2022 UI
 * multiplier instead of minting, so the raw balance alone understates the
 * shares held. Uses the new multiplier once its effective time has passed.
 */
function multiplierOf(mint: ParsedAccountData | undefined, nowSecs: number): number {
  const exts = (mint?.parsed?.info?.extensions ?? []) as { extension: string; state: unknown }[];
  const cfg = exts.find((e) => e.extension === "scaledUiAmountConfig")?.state as ScaledUiAmountConfig | undefined;
  if (!cfg) return 1;
  const m = Number(nowSecs >= cfg.newMultiplierEffectiveTimestamp ? cfg.newMultiplier : cfg.multiplier);
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/** The tokenized stocks `owner` holds on mainnet. Read-only. */
export async function mainnetHoldings(owner: PublicKey): Promise<Holding[]> {
  const connection = new Connection(MAINNET_RPC_URL, "confirmed");
  const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID });

  const balances = new Map<string, { raw: bigint; decimals: number }>();
  for (const { account } of value) {
    const info = account.data.parsed.info as { mint: string; tokenAmount: { amount: string; decimals: number } };
    if (!KNOWN.has(info.mint)) continue;
    const prev = balances.get(info.mint)?.raw ?? 0n;
    balances.set(info.mint, { raw: prev + BigInt(info.tokenAmount.amount), decimals: info.tokenAmount.decimals });
  }
  const held = [...balances].filter(([, b]) => b.raw > 0n);
  if (held.length === 0) return [];

  const mints = await connection.getMultipleParsedAccounts(held.map(([mint]) => new PublicKey(mint)));
  const now = Math.floor(Date.now() / 1000);
  return held.map(([mint, b], i) => {
    const data = mints.value[i]?.data;
    const multiplier = multiplierOf(data && "parsed" in data ? data : undefined, now);
    return { ...KNOWN.get(mint)!, shares: (Number(b.raw) / 10 ** b.decimals) * multiplier };
  });
}
