import { describe, expect, it } from "vitest";

import { backtestCover, gapModel, ladderOdds, MIN_HISTORY, openingHistory, seedSplit } from "./gapModel";
import { modelProbabilityAbove } from "./ladder";
import { STOCKS } from "./stocks";

const TSLA = STOCKS.find((s) => s.symbol === "TSLA")!;
const WEEKNIGHT = 17.5 / (365 * 24);

describe("gapModel", () => {
  it("falls back to the lognormal model, and the keeper's old ladders, without enough history", () => {
    const model = gapModel(TSLA, WEEKNIGHT, openingHistory(TSLA).slice(0, MIN_HISTORY - 1));
    expect(model.source).toBe("lognormal");
    const odds = ladderOdds(model, 374.07, TSLA.tick);
    // The ladder createLadder built before the history model: 0.6 sd steps on the tick, centered on spot.
    const sd = 374.07 * TSLA.annualVol * Math.sqrt(WEEKNIGHT);
    const step = Math.max(TSLA.tick, Math.round((sd * 0.6) / TSLA.tick) * TSLA.tick);
    expect(odds.map((o) => o.strike)).toEqual([365, 370, 375, 380, 385]);
    expect(step).toBe(5);
    for (const o of odds) {
      const p = modelProbabilityAbove(374.07, o.strike, TSLA.annualVol, WEEKNIGHT);
      expect(o.p).toBeCloseTo(Math.min(0.95, Math.max(0.05, p)), 12);
    }
  });

  it("prices from history once there is enough of it", () => {
    const model = gapModel(TSLA, WEEKNIGHT, openingHistory(TSLA));
    expect(model.source).toBe("history");
    expect(model.sd).toBeGreaterThan(0.01);
    expect(model.sd).toBeLessThan(TSLA.annualVol * Math.sqrt(WEEKNIGHT));
    const ps = [340, 360, 370, 375, 380, 390, 410].map((k) => model.probabilityAbove(375, k));
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeLessThan(ps[i - 1]);
    expect(ps[0]).toBeLessThan(1);
    expect(ps.at(-1)).toBeGreaterThan(0);
  });

  it("keeps the history's shape: a 3% drop is likelier than a 3% rise", () => {
    const model = gapModel(TSLA, WEEKNIGHT, openingHistory(TSLA));
    const drop = 1 - model.probabilityAbove(375, 375 * Math.exp(-0.03));
    const rise = model.probabilityAbove(375, 375 * Math.exp(0.03));
    expect(drop).toBeGreaterThan(rise);
  });

  it("keeps a tail move seen once: a normal curve with the same sd prices it lower", () => {
    const model = gapModel(TSLA, WEEKNIGHT, openingHistory(TSLA));
    const k = 375 * Math.exp(-0.08);
    const normal = modelProbabilityAbove(375, k, model.sd, 1);
    expect(1 - model.probabilityAbove(375, k)).toBeGreaterThan(1 - normal);
  });

  it("splits a seed like the keeper always has", () => {
    expect(seedSplit(5_000_000_000n, 0.66)).toEqual({ yes: 3_300_000_000n, no: 1_700_000_000n });
    expect(seedSplit(10n, 0)).toEqual({ yes: 1n, no: 9n });
  });
});

describe("backtestCover", () => {
  const history = openingHistory(TSLA);
  const bt = backtestCover(TSLA, history, 10);

  it("prices each night only from the openings before it", () => {
    const changed = history.map((o, i) => (i === history.length - 1 ? { ...o, open: o.close * 0.5 } : o));
    const again = backtestCover(TSLA, changed, 10);
    expect(again.nights.slice(0, -1)).toEqual(bt.nights.slice(0, -1));
  });

  it("uses history from the MIN_HISTORY-th night on", () => {
    expect(bt.nights.slice(0, MIN_HISTORY).every((n) => n.source === "lognormal")).toBe(true);
    expect(bt.nights.slice(MIN_HISTORY).every((n) => n.source === "history")).toBe(true);
    expect(bt.priced.nights).toBe(history.length - MIN_HISTORY);
  });

  it("never pays more than the shares lost, and pays nothing on a higher open", () => {
    for (const n of bt.nights) {
      expect(n.paid).toBeLessThanOrEqual(n.loss + 1e-6);
      if (n.open >= n.close) expect(n.paid).toBe(0);
      expect(n.cost).toBeGreaterThan(0);
    }
  });

  it("costs less priced from history than from the lognormal model", () => {
    expect(bt.priced.cost).toBeLessThan(bt.priced.lognormalCost);
  });
});
