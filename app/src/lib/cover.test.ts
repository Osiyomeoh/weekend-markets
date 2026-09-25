import { describe, expect, it } from "vitest";

import { coverPayout, coverPlan, defaultCoverRange, stakeForPayout } from "./cover";
import { MarketView, previewPayout } from "./ladder";

const U = 1_000_000; // raw units per dollar
const $ = (x: number) => BigInt(Math.round(x * U));

function market(strike: number, yes: number, no: number, over: Partial<MarketView> = {}): MarketView {
  return {
    address: `m${strike}`,
    creator: "c",
    marketId: String(strike),
    feedId: "0xaa",
    strike,
    lockTs: 10,
    resolveTs: 20,
    resolveWindowSecs: 60,
    voidDelaySecs: 3600,
    maxConfBps: 100,
    yesPool: $(yes),
    noPool: $(no),
    openPositions: 1,
    status: "open",
    outcome: null,
    voidReason: null,
    settlePrice: null,
    settleConf: null,
    settlePublishTime: null,
    ...over,
  };
}

describe("stakeForPayout", () => {
  it("returns the smallest stake that reaches the target", () => {
    const m = market(100, 700, 300);
    for (const target of [$(1), $(141.5), $(10_000), 7n]) {
      const s = stakeForPayout(m, "no", target);
      expect(previewPayout(m, "no", s)).toBeGreaterThanOrEqual(target);
      expect(previewPayout(m, "no", s - 1n)).toBeLessThan(target);
    }
  });

  it("prices close to the crowd's odds when the pool is deep", () => {
    const m = market(100, 700_000, 300_000);
    const s = stakeForPayout(m, "no", $(100));
    expect(Number(s) / U).toBeCloseTo(30, 0);
  });

  it("pays the whole pool back when the chosen side is empty", () => {
    const m = market(100, 50, 0);
    // With no NO stake yet, a NO stake of s wins s + 50.
    expect(stakeForPayout(m, "no", $(80))).toBe($(30));
  });

  it("is zero for a zero target", () => {
    expect(stakeForPayout(market(100, 1, 1), "no", 0n)).toBe(0n);
  });
});

describe("coverPlan", () => {
  // Spot 376.65; strikes every $15 around it.
  const ladder = [
    market(347.5, 4450, 550),
    market(362.5, 3550, 1450),
    market(377.5, 2350, 2650),
    market(392.5, 1200, 3800),
  ];

  it("uses one NO leg per strike below spot, closest first", () => {
    const plan = coverPlan(ladder, 376.65, 10, U);
    expect(plan.legs.map((l) => l.strike)).toEqual([362.5, 347.5]);
    expect(plan.legs[0].payout).toBe($(141.5));
    expect(plan.legs[1].payout).toBe($(150));
    expect(plan.maxPayout).toBe($(291.5));
    expect(plan.cost).toBe(plan.legs[0].stake + plan.legs[1].stake);
  });

  it("pays the loss at each strike and never more than the loss", () => {
    const spot = 376.65;
    const shares = 10;
    const plan = coverPlan(ladder, spot, shares, U);
    for (let price = 300; price <= 400; price += 0.25) {
      const paid = Number(coverPayout(plan, price)) / U;
      const loss = Math.max(0, shares * (spot - price));
      expect(paid).toBeLessThanOrEqual(loss + 1e-9);
    }
    // Just below a strike, cover pays exactly the loss down to that strike.
    expect(coverPayout(plan, 362.49)).toBe($(141.5));
    expect(coverPayout(plan, 347.49)).toBe($(291.5));
    // At or above the first strike it pays nothing: a tie settles YES.
    expect(coverPayout(plan, 362.5)).toBe(0n);
  });

  it("stops at the chosen floor", () => {
    const plan = coverPlan(ladder, 376.65, 10, U, { to: 360 });
    expect(plan.legs.map((l) => l.strike)).toEqual([362.5]);
  });

  it("adds a deductible when cover starts lower, still paying the full loss at the strike", () => {
    const ladder3 = [market(347.5, 4450, 550), market(362.5, 3550, 1450), market(375, 2600, 2400)];
    const full = coverPlan(ladder3, 376.65, 10, U);
    const deductible = coverPlan(ladder3, 376.65, 10, U, { from: 362.5 });
    expect(deductible.legs.map((l) => l.strike)).toEqual([362.5, 347.5]);
    expect(deductible.legs[0].payout).toBe($(141.5));
    expect(coverPayout(deductible, 370)).toBe(0n);
    expect(coverPayout(deductible, 362)).toBe(coverPayout(full, 362));
    expect(deductible.cost).toBeLessThan(full.cost);
  });

  it("skips markets that are no longer open", () => {
    const closed = [market(362.5, 3550, 1450, { status: "resolved", outcome: "yes" }), ladder[0]];
    const plan = coverPlan(closed, 376.65, 10, U);
    expect(plan.legs.map((l) => l.strike)).toEqual([347.5]);
    // The only leg covers the whole gap from spot.
    expect(plan.legs[0].payout).toBe($(10 * (376.65 - 347.5)));
  });

  it("is empty with no position or no strikes below spot", () => {
    expect(coverPlan(ladder, 376.65, 0, U).legs).toEqual([]);
    expect(coverPlan(ladder, 340, 10, U).legs).toEqual([]);
    expect(coverPlan(ladder, Number.NaN, 10, U).legs).toEqual([]);
  });
});

describe("defaultCoverRange", () => {
  const ladder = [market(90, 900, 100), market(95, 800, 200), market(99.5, 600, 400), market(105, 300, 700)];

  it("skips strikes within 1% of the price and runs to the lowest", () => {
    expect(defaultCoverRange(ladder, 100)).toEqual({ from: 95, to: 90 });
  });

  it("falls back to the nearest strike when every strike is within 1%", () => {
    expect(defaultCoverRange([market(99.5, 600, 400)], 100)).toEqual({ from: 99.5, to: 99.5 });
  });

  it("ignores closed markets and is null with nothing below the price", () => {
    expect(defaultCoverRange([market(95, 800, 200, { status: "resolved" }), market(105, 300, 700)], 100)).toBeNull();
  });
});
