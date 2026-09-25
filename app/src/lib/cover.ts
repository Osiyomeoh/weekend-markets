/**
 * Gap cover: protection for someone holding a stock (or its tokenized
 * version) against a lower print at settlement, built from the ladder's
 * binary markets. Pure, so it is unit tested directly.
 *
 * A put pays `shares × (spot − price)` below spot. The ladder can't pay that
 * exactly, but a strip of NO stakes can pay it in steps: one leg per strike
 * below spot, each sized to pay `shares × (gap to the strike above it)`. If
 * the stock settles below strike k, every leg at or above k wins, and those
 * payouts add up to `shares × (spot − k)`, the loss at k. So:
 *
 *   - above the first strike, cover pays nothing (the deductible);
 *   - below it, cover lags the loss by less than one strike step;
 *   - it never pays more than the loss, so it is a hedge, not a bet.
 */
import { MarketView, previewPayout } from "./ladder";

export type CoverLeg = {
  market: MarketView;
  strike: number;
  /** What this leg pays if the stock settles below `strike`, at current pools. */
  payout: bigint;
  /** NO stake needed for that payout, including its own effect on the pool. */
  stake: bigint;
};

export type CoverPlan = {
  /** Descending by strike: the first leg is the one closest to spot. */
  legs: CoverLeg[];
  cost: bigint;
  /** Paid if the stock settles below the lowest covered strike. */
  maxPayout: bigint;
};

/**
 * Smallest stake whose payout, if `side` wins, is at least `target`, assuming
 * the pools don't otherwise move. Payout is `floor(s(T+s)/(W+s))`, which is
 * non-decreasing in s and never less than s, so the answer is in [1, target].
 */
export function stakeForPayout(m: Pick<MarketView, "yesPool" | "noPool">, side: "yes" | "no", target: bigint): bigint {
  if (target <= 0n) return 0n;
  let lo = 1n;
  let hi = target;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (previewPayout(m, side, mid) >= target) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

/**
 * The NO strip that covers `shares` using the strikes between `from` and `to`
 * (inclusive), both below spot. Starting `from` below the nearest strike adds
 * a deductible; the first leg still pays the whole loss from spot. Only open
 * markets are used. `unitsPerDollar` converts dollars to raw collateral (1e6
 * for a 6-decimal dollar stablecoin).
 */
export function coverPlan(
  markets: MarketView[],
  spot: number,
  shares: number,
  unitsPerDollar: number,
  range: { from?: number; to?: number } = {},
): CoverPlan {
  if (!(spot > 0) || !(shares > 0)) return { legs: [], cost: 0n, maxPayout: 0n };
  const from = range.from ?? Infinity;
  const to = range.to ?? -Infinity;
  const strikes = markets
    .filter((m) => m.status === "open" && m.strike < spot && m.strike <= from && m.strike >= to)
    .sort((a, b) => b.strike - a.strike);

  const legs: CoverLeg[] = [];
  let above = spot;
  for (const market of strikes) {
    const payout = BigInt(Math.round(shares * (above - market.strike) * unitsPerDollar));
    above = market.strike;
    if (payout <= 0n) continue;
    legs.push({ market, strike: market.strike, payout, stake: stakeForPayout(market, "no", payout) });
  }
  return {
    legs,
    cost: legs.reduce((a, l) => a + l.stake, 0n),
    maxPayout: legs.reduce((a, l) => a + l.payout, 0n),
  };
}

/**
 * The default range: from the first strike at least 1% below the price (a leg
 * hugging the price costs about as much as it pays) down to the lowest open
 * strike. Null when no open strike is below the price.
 */
export function defaultCoverRange(markets: MarketView[], spot: number): { from: number; to: number } | null {
  const below = markets
    .filter((m) => m.status === "open" && m.strike < spot)
    .map((m) => m.strike)
    .sort((a, b) => b - a);
  if (below.length === 0) return null;
  return { from: below.find((k) => k <= spot * 0.99) ?? below[0], to: below.at(-1)! };
}

/** What the plan pays if the stock settles at `price` (NO wins below the strike). */
export function coverPayout(plan: CoverPlan, price: number): bigint {
  return plan.legs.reduce((a, l) => (price < l.strike ? a + l.payout : a), 0n);
}
