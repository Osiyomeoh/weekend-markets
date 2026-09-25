/**
 * Opening odds from Pyth's own history of opening moves, and a backtest of
 * cover priced that way. Pure, so it is unit tested directly.
 *
 * A lognormal with the stock's annual volatility treats every hour between a
 * close and the next open as a trading hour. Most of them aren't: across
 * TSLA's openings since July the close-to-open move had a standard deviation
 * of about 1.8%, where 60% annual volatility implies 2.7% over a weeknight and
 * 5.2% over a weekend (and weekend moves were no larger than weeknight ones).
 * Seeding ladders from the history prices cover at what openings have
 * actually cost. The history is kernel-smoothed rather than fitted to a
 * normal curve, so a tail move seen once (−8.8% on 23 July) keeps its weight.
 */
import tslaOpenings from "../data/tsla-gaps.json";
import { coverPayout, coverPlan, defaultCoverRange } from "./cover";
import { DEFAULT_LADDER, MarketView, modelProbabilityAbove, normCdf } from "./ladder";
import { nyTimestamp } from "./sessions";
import { Stock } from "./stocks";

/** One close-to-open move, from Pyth prints (scripts/gaps.ts). */
export type Opening = { from: string; to: string; close: number; open: number; gap: number; weekend: boolean };

/** With fewer past openings than this, the lognormal model seeds the ladder instead. */
export const MIN_HISTORY = 10;

const HISTORY: Record<string, Opening[]> = { TSLA: tslaOpenings.gaps };

/** Every recorded opening for the stock, oldest first. Empty when there is no history yet. */
export function openingHistory(stock: Pick<Stock, "symbol">): Opening[] {
  return HISTORY[stock.symbol] ?? [];
}

export type GapModel = {
  source: "history" | "lognormal";
  /** Standard deviation of the log move from now to the open. */
  sd: number;
  probabilityAbove: (spot: number, strike: number) => number;
};

/**
 * The distribution of the next opening print. From `history` when it has at
 * least MIN_HISTORY openings: their log moves, recentered to average zero (no
 * drift, like the lognormal: it prices the size of moves, not a direction, but
 * keeps their shape, many small rises and rare large drops) and smoothed with
 * a Gaussian kernel (Silverman's bandwidth). Otherwise a driftless lognormal
 * over `years`.
 */
export function gapModel(stock: Pick<Stock, "annualVol">, years: number, history: readonly Opening[]): GapModel {
  if (history.length < MIN_HISTORY) {
    return {
      source: "lognormal",
      sd: stock.annualVol * Math.sqrt(Math.max(years, 0)),
      probabilityAbove: (spot, strike) => modelProbabilityAbove(spot, strike, stock.annualVol, years),
    };
  }
  const moves = history.map((o) => Math.log(o.open / o.close));
  const mean = moves.reduce((a, m) => a + m, 0) / moves.length;
  const centered = moves.map((m) => m - mean);
  const sd = Math.sqrt(centered.reduce((a, m) => a + m * m, 0) / (centered.length - 1));
  const bandwidth = Math.max(0.9 * sd * centered.length ** -0.2, 0.002);
  return {
    source: "history",
    sd,
    probabilityAbove: (spot, strike) => {
      const x = Math.log(strike / spot);
      return centered.reduce((a, m) => a + 1 - normCdf((x - m) / bandwidth), 0) / centered.length;
    },
  };
}

function roundToTick(x: number, tick: number): number {
  return Math.round(x / tick) * tick;
}

/**
 * A ladder's strikes around `spot`, about 0.6 standard deviations apart, with
 * the opening probability of YES at each (held within 5–95%, so neither side
 * of a seeded pool is empty).
 */
export function ladderOdds(
  model: GapModel,
  spot: number,
  tick: number,
  strikes: number = DEFAULT_LADDER.strikes,
): { strike: number; p: number }[] {
  const step = Math.max(tick, roundToTick(spot * model.sd * 0.6, tick));
  const center = roundToTick(spot, tick);
  const half = (strikes - 1) / 2;
  const out = [];
  for (let k = -half; k <= half; k++) {
    const strike = center + k * step;
    out.push({ strike, p: Math.min(0.95, Math.max(0.05, model.probabilityAbove(spot, strike))) });
  }
  return out;
}

/** Splits a seed stake YES/NO at probability `p`, as the keeper does. */
export function seedSplit(seed: bigint, p: number): { yes: bigint; no: bigint } {
  const yes = BigInt(Math.max(1, Math.round(Number(seed) * p)));
  return { yes, no: seed - yes };
}

export type BacktestNight = {
  from: string;
  to: string;
  close: number;
  open: number;
  gap: number;
  source: GapModel["source"];
  /** Cover bought at the close, at the seeded odds: cost and payout at the open, in dollars. */
  cost: number;
  paid: number;
  /** What the shares lost at the open (0 if it opened higher). */
  loss: number;
  /** The same cover priced by the lognormal model, for comparison. */
  lognormalCost: number;
  lognormalPaid: number;
};

export type Backtest = {
  shares: number;
  nights: BacktestNight[];
  /** Totals over the nights priced from history (the out-of-sample ones). */
  priced: { nights: number; cost: number; paid: number; loss: number; paidNights: number; lognormalCost: number; lognormalPaid: number };
};

/**
 * Replays cover on every past opening: at each close, a ladder seeded the way
 * the keeper seeds one, priced only from the openings before it (no
 * look-ahead); the default cover range the Cover page offers; paid by the
 * actual opening print.
 */
export function backtestCover(
  stock: Pick<Stock, "annualVol" | "tick">,
  openings: readonly Opening[],
  shares: number,
): Backtest {
  const unitsPerDollar = 1e6;
  const seed = BigInt(DEFAULT_LADDER.seed * unitsPerDollar);
  const ymd = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return { y, m, d };
  };

  const run = (model: GapModel, o: Opening) => {
    const markets = ladderOdds(model, o.close, stock.tick).map(({ strike, p }) => {
      const { yes, no } = seedSplit(seed, p);
      return { strike, status: "open", yesPool: yes, noPool: no } as MarketView;
    });
    const range = defaultCoverRange(markets, o.close);
    if (!range) return { cost: 0, paid: 0 };
    const plan = coverPlan(markets, o.close, shares, unitsPerDollar, range);
    return { cost: Number(plan.cost) / unitsPerDollar, paid: Number(coverPayout(plan, o.open)) / unitsPerDollar };
  };

  const nights = openings.map((o, i): BacktestNight => {
    const years = (nyTimestamp(ymd(o.to), 9, 30) - nyTimestamp(ymd(o.from), 16, 0)) / (365 * 86_400);
    const model = gapModel(stock, years, openings.slice(0, i));
    const priced = run(model, o);
    const lognormal = run(gapModel(stock, years, []), o);
    return {
      from: o.from,
      to: o.to,
      close: o.close,
      open: o.open,
      gap: o.gap,
      source: model.source,
      cost: priced.cost,
      paid: priced.paid,
      loss: Math.max(0, shares * (o.close - o.open)),
      lognormalCost: lognormal.cost,
      lognormalPaid: lognormal.paid,
    };
  });

  const outOfSample = nights.filter((n) => n.source === "history");
  const sum = (f: (n: BacktestNight) => number) => outOfSample.reduce((a, n) => a + f(n), 0);
  return {
    shares,
    nights,
    priced: {
      nights: outOfSample.length,
      cost: sum((n) => n.cost),
      paid: sum((n) => n.paid),
      loss: sum((n) => n.loss),
      paidNights: outOfSample.filter((n) => n.paid > 0).length,
      lognormalCost: sum((n) => n.lognormalCost),
      lognormalPaid: sum((n) => n.lognormalPaid),
    },
  };
}
