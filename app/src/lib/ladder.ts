/**
 * Pure market math for the UI: grouping markets into strike ladders, implied
 * probabilities, the crowd-implied settlement price, and payout previews.
 * No I/O here, so it is unit tested directly.
 */

export type Side = "yes" | "no";
export type Status = "open" | "resolved" | "voided";

export type MarketView = {
  address: string;
  creator: string;
  marketId: string;
  feedId: string;
  /** Strike in dollars. */
  strike: number;
  lockTs: number;
  resolveTs: number;
  resolveWindowSecs: number;
  /** After the window, a market with no valid print can be voided once this passes. */
  voidDelaySecs: number;
  /** Largest Pyth confidence interval accepted, in basis points of the price. */
  maxConfBps: number;
  yesPool: bigint;
  noPool: bigint;
  openPositions: number;
  status: Status;
  outcome: Side | null;
  voidReason: "oneSidedPool" | "noOraclePrice" | null;
  /** Settlement price in dollars, when resolved. */
  settlePrice: number | null;
  settleConf: number | null;
  settlePublishTime: number | null;
};

export type Series = {
  feedId: string;
  resolveTs: number;
  lockTs: number;
  /** Ascending by strike. */
  markets: MarketView[];
};

export function toNumber(value: bigint | number, expo: number): number {
  return Number(value) * 10 ** expo;
}

/** Dollar strike -> (price, expo) at cent precision, as stored on-chain. */
export function strikeToOnChain(usd: number): { price: number; expo: number } {
  const cents = Math.round(usd * 100);
  if (!Number.isFinite(usd) || cents <= 0) throw new Error(`invalid strike ${usd}`);
  return { price: cents, expo: -2 };
}

/** Markets sharing a feed and a resolve time form one ladder. */
export function groupSeries(markets: MarketView[]): Series[] {
  const bySeries = new Map<string, MarketView[]>();
  for (const m of markets) {
    const key = `${m.feedId}:${m.resolveTs}`;
    bySeries.set(key, [...(bySeries.get(key) ?? []), m]);
  }
  return [...bySeries.values()]
    .map((ms) => {
      const sorted = [...ms].sort((a, b) => a.strike - b.strike);
      return {
        feedId: sorted[0].feedId,
        resolveTs: sorted[0].resolveTs,
        lockTs: Math.min(...sorted.map((m) => m.lockTs)),
        markets: sorted,
      };
    })
    .sort((a, b) => a.resolveTs - b.resolveTs || a.feedId.localeCompare(b.feedId));
}

/** Crowd probability that the settlement price is at or above the strike. */
export function impliedProbability(m: Pick<MarketView, "yesPool" | "noPool">): number | null {
  const total = m.yesPool + m.noPool;
  if (total === 0n) return null;
  return Number((m.yesPool * 1_000_000n) / total) / 1_000_000;
}

/**
 * P(price >= strike) must fall as the strike rises. Independent pools can
 * disagree, so we fit the closest non-increasing curve (pool-adjacent-violators,
 * weighted by pool size) to make the ladder read as one distribution.
 */
export function coherentCurve(
  points: { strike: number; p: number; weight: number }[],
): { strike: number; p: number }[] {
  const blocks: { p: number; w: number; strikes: number[] }[] = [];
  for (const pt of [...points].sort((a, b) => a.strike - b.strike)) {
    blocks.push({ p: pt.p, w: Math.max(pt.weight, 1e-9), strikes: [pt.strike] });
    while (blocks.length > 1 && blocks[blocks.length - 2].p < blocks[blocks.length - 1].p) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      const w = a.w + b.w;
      blocks.push({ p: (a.p * a.w + b.p * b.w) / w, w, strikes: [...a.strikes, ...b.strikes] });
    }
  }
  return blocks.flatMap((b) => b.strikes.map((strike) => ({ strike, p: b.p })));
}

export function seriesCurve(series: Series): { strike: number; p: number }[] {
  const points = series.markets.flatMap((m) => {
    const p = impliedProbability(m);
    return p === null ? [] : [{ strike: m.strike, p, weight: Number(m.yesPool + m.noPool) }];
  });
  return coherentCurve(points);
}

/**
 * The strike at which the crowd is 50/50, linearly interpolated between the
 * two strikes that bracket 0.5. Null when the ladder doesn't bracket it.
 */
export function impliedMedian(curve: { strike: number; p: number }[]): number | null {
  const pts = [...curve].sort((a, b) => a.strike - b.strike);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.p >= 0.5 && b.p <= 0.5) {
      if (a.p === b.p) return (a.strike + b.strike) / 2;
      return a.strike + ((a.p - 0.5) / (a.p - b.p)) * (b.strike - a.strike);
    }
  }
  return null;
}

/**
 * What a new stake would pay if its side wins, assuming the pools don't move.
 * Mirrors the program: stake * (yes + no) / winning_pool, floored.
 */
export function previewPayout(
  m: Pick<MarketView, "yesPool" | "noPool">,
  side: Side,
  amount: bigint,
): bigint {
  if (amount <= 0n) return 0n;
  const yes = m.yesPool + (side === "yes" ? amount : 0n);
  const no = m.noPool + (side === "no" ? amount : 0n);
  const winning = side === "yes" ? yes : no;
  return (amount * (yes + no)) / winning;
}

/** What a stake already in the pool pays if its side wins, at the pools as they stand. */
export function currentPayout(m: Pick<MarketView, "yesPool" | "noPool">, side: Side, stake: bigint): bigint {
  const pool = side === "yes" ? m.yesPool : m.noPool;
  if (stake <= 0n || pool === 0n) return 0n;
  return (stake * (m.yesPool + m.noPool)) / pool;
}

/** Payout owed to a settled position, mirroring `math::payout` on-chain. */
export function positionPayout(
  m: Pick<MarketView, "status" | "outcome" | "yesPool" | "noPool">,
  yesAmount: bigint,
  noAmount: bigint,
): bigint | null {
  if (m.status === "open") return null;
  if (m.status === "voided") return yesAmount + noAmount;
  const stake = m.outcome === "yes" ? yesAmount : noAmount;
  const winning = m.outcome === "yes" ? m.yesPool : m.noPool;
  if (stake === 0n || winning === 0n) return 0n;
  return (stake * (m.yesPool + m.noPool)) / winning;
}

/** Standard normal CDF (Abramowitz-Stegun 26.2.17, |error| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const tail =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

/**
 * Lognormal (driftless) probability that a stock at `spot` prints at or
 * above `strike` after `years`. Used only to seed opening odds.
 */
export function modelProbabilityAbove(spot: number, strike: number, annualVol: number, years: number): number {
  if (years <= 0 || annualVol <= 0) return spot >= strike ? 1 : 0;
  const sd = annualVol * Math.sqrt(years);
  return 1 - normCdf((Math.log(strike / spot) + (sd * sd) / 2) / sd);
}
