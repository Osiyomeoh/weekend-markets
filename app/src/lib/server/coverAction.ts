import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT, OPERATOR } from "../config";
import { coverPlan, CoverPlan, defaultCoverRange } from "../cover";
import { groupSeries, Series } from "../ladder";
import { fetchMarkets, getProgram, placeBetIxs } from "../program";
import { Stock } from "../stocks";
import { latestQuotes, Quote } from "./pyth";

const UNIT = 10 ** COLLATERAL_DECIMALS;

/** A reason to show the person, not a server fault. */
export class OfferError extends Error {}

export type CoverOffer = { stock: Stock; spot: number; series: Series; shares: number; plan: CoverPlan };

// Link previews fetch the action often; Hermes calls are keyed and metered.
let cache: { at: number; quotes: Record<string, Quote> } | null = null;
const TTL_MS = 5_000;

async function spotOf(stock: Stock): Promise<number> {
  if (!cache || Date.now() - cache.at > TTL_MS || !cache.quotes[stock.equityFeedId]) {
    cache = { at: Date.now(), quotes: await latestQuotes([stock.equityFeedId]) };
  }
  const price = cache.quotes[stock.equityFeedId]?.price;
  if (!price) throw new OfferError(`No Pyth price for ${stock.symbol} right now.`);
  return price;
}

/**
 * Cover for `shares` on the furthest ladder still taking stakes (the one that
 * spans the weekend), over the app's default range. The same plan the Cover
 * page and the MCP agent build.
 */
export async function coverOffer(connection: Connection, stock: Stock, shares: number): Promise<CoverOffer> {
  const [markets, spot] = await Promise.all([fetchMarkets(getProgram(connection), OPERATOR), spotOf(stock)]);
  const now = Date.now() / 1000;
  const series = groupSeries(markets)
    .filter((s) => s.feedId === stock.equityFeedId && now < s.lockTs && s.markets.some((m) => m.status === "open"))
    .at(-1);
  if (!series) throw new OfferError("No ladder is taking stakes right now. A new one opens before every opening bell.");
  const range = defaultCoverRange(series.markets, spot);
  if (!range) throw new OfferError(`Every strike is above ${stock.symbol}'s price, so there is nothing to cover.`);
  const plan = coverPlan(series.markets, spot, shares, UNIT, range);
  if (plan.legs.length === 0) throw new OfferError("That position is too small to cover.");
  return { stock, spot, series, shares, plan };
}

/** The purchase as an unsigned transaction for `owner` to sign and pay fees on. */
export async function coverTransaction(
  connection: Connection,
  owner: PublicKey,
  offer: CoverOffer,
): Promise<Transaction> {
  const program = getProgram(connection);
  const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, owner);
  const legs = await Promise.all(
    offer.plan.legs.map((l) =>
      placeBetIxs(program, { market: new PublicKey(l.market.address), bettor: owner, side: "no", amount: l.stake }),
    ),
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  return new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, COLLATERAL_MINT),
    ...legs.flat(),
  );
}
