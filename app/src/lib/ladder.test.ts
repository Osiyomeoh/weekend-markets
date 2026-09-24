import { describe, expect, it } from "vitest";
import {
  coherentCurve,
  groupSeries,
  impliedMedian,
  impliedProbability,
  MarketView,
  modelProbabilityAbove,
  normCdf,
  positionPayout,
  previewPayout,
  strikeToOnChain,
} from "./ladder";

function market(over: Partial<MarketView>): MarketView {
  return {
    address: "m",
    creator: "c",
    marketId: "1",
    feedId: "0xaa",
    strike: 100,
    lockTs: 10,
    resolveTs: 20,
    resolveWindowSecs: 60,
    yesPool: 0n,
    noPool: 0n,
    openPositions: 0,
    status: "open",
    outcome: null,
    voidReason: null,
    settlePrice: null,
    settleConf: null,
    settlePublishTime: null,
    ...over,
  };
}

describe("strikeToOnChain", () => {
  it("stores cents at expo -2", () => {
    expect(strikeToOnChain(180)).toEqual({ price: 18000, expo: -2 });
    expect(strikeToOnChain(182.5)).toEqual({ price: 18250, expo: -2 });
  });
  it("rejects non-positive and non-finite strikes", () => {
    expect(() => strikeToOnChain(0)).toThrow();
    expect(() => strikeToOnChain(Number.NaN)).toThrow();
  });
});

describe("groupSeries", () => {
  it("groups by feed and resolve time, sorts strikes ascending", () => {
    const series = groupSeries([
      market({ address: "b", strike: 110 }),
      market({ address: "a", strike: 90 }),
      market({ address: "c", strike: 100, resolveTs: 99 }),
      market({ address: "d", strike: 100, feedId: "0xbb" }),
    ]);
    expect(series).toHaveLength(3);
    expect(series[0].markets.map((m) => m.address)).toEqual(["a", "b"]);
    expect(series.at(-1)!.resolveTs).toBe(99);
  });
});

describe("impliedProbability", () => {
  it("is yes share of the pot", () => {
    expect(impliedProbability({ yesPool: 30n, noPool: 70n })).toBeCloseTo(0.3);
  });
  it("is null for an empty market", () => {
    expect(impliedProbability({ yesPool: 0n, noPool: 0n })).toBeNull();
  });
});

describe("coherentCurve", () => {
  it("leaves a decreasing curve unchanged", () => {
    const pts = [
      { strike: 1, p: 0.9, weight: 1 },
      { strike: 2, p: 0.5, weight: 1 },
      { strike: 3, p: 0.1, weight: 1 },
    ];
    expect(coherentCurve(pts).map((x) => x.p)).toEqual([0.9, 0.5, 0.1]);
  });
  it("pools violators by weight", () => {
    const out = coherentCurve([
      { strike: 1, p: 0.4, weight: 1 },
      { strike: 2, p: 0.6, weight: 3 },
    ]);
    expect(out[0].p).toBeCloseTo(0.55);
    expect(out[1].p).toBeCloseTo(0.55);
  });
});

describe("impliedMedian", () => {
  it("interpolates the 50% crossing", () => {
    expect(
      impliedMedian([
        { strike: 100, p: 0.7 },
        { strike: 110, p: 0.3 },
      ]),
    ).toBeCloseTo(105);
  });
  it("returns null when 50% is not bracketed", () => {
    expect(impliedMedian([{ strike: 100, p: 0.7 }, { strike: 110, p: 0.6 }])).toBeNull();
  });
});

describe("payouts mirror the program", () => {
  it("previews a winning stake including itself in the pools", () => {
    // yes 100, no 300; add 100 yes => pot 500, yes 200 => 100 * 500 / 200 = 250
    expect(previewPayout({ yesPool: 100n, noPool: 300n }, "yes", 100n)).toBe(250n);
  });
  it("first stake on an empty side is paid the whole pot", () => {
    expect(previewPayout({ yesPool: 0n, noPool: 300n }, "yes", 100n)).toBe(400n);
  });
  it("floors like the program", () => {
    expect(
      positionPayout({ status: "resolved", outcome: "yes", yesPool: 3n, noPool: 7n }, 1n, 0n),
    ).toBe(3n);
  });
  it("refunds everything when voided", () => {
    expect(positionPayout({ status: "voided", outcome: null, yesPool: 5n, noPool: 0n }, 3n, 2n)).toBe(5n);
  });
  it("is null while open", () => {
    expect(positionPayout({ status: "open", outcome: null, yesPool: 1n, noPool: 1n }, 1n, 0n)).toBeNull();
  });
});

describe("seeding model", () => {
  it("normCdf is accurate", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("at-the-money is just under 50% and decreases with strike", () => {
    const atm = modelProbabilityAbove(100, 100, 0.5, 3 / 365);
    expect(atm).toBeLessThan(0.5);
    expect(atm).toBeGreaterThan(0.48);
    expect(modelProbabilityAbove(100, 105, 0.5, 3 / 365)).toBeLessThan(atm);
  });
  it("collapses to 0/1 at expiry", () => {
    expect(modelProbabilityAbove(100, 99, 0.5, 0)).toBe(1);
    expect(modelProbabilityAbove(100, 101, 0.5, 0)).toBe(0);
  });
});
