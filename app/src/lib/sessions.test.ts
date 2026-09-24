import { describe, expect, it } from "vitest";

import { nextOpeningBell, nyTimestamp } from "./sessions";

const utc = (iso: string) => Date.parse(iso) / 1000;
const LOCK = 300;

describe("nyTimestamp", () => {
  it("handles daylight time and standard time", () => {
    expect(nyTimestamp({ y: 2026, m: 9, d: 28 }, 9, 30)).toBe(utc("2026-09-28T13:30:00Z")); // EDT
    expect(nyTimestamp({ y: 2026, m: 12, d: 7 }, 9, 30)).toBe(utc("2026-12-07T14:30:00Z")); // EST
  });

  it("is right on the days the clocks change", () => {
    expect(nyTimestamp({ y: 2026, m: 11, d: 2 }, 9, 30)).toBe(utc("2026-11-02T14:30:00Z")); // Monday after fall back
    expect(nyTimestamp({ y: 2026, m: 3, d: 9 }, 9, 30)).toBe(utc("2026-03-09T13:30:00Z")); // Monday after spring forward
  });
});

describe("nextOpeningBell", () => {
  it("picks tomorrow's open on a weekday evening", () => {
    expect(nextOpeningBell(utc("2026-09-24T19:40:00Z"), 1200, LOCK)).toBe(utc("2026-09-25T13:30:00Z"));
  });

  it("skips the weekend once Friday's betting has closed", () => {
    expect(nextOpeningBell(utc("2026-09-25T13:26:00Z"), 0, LOCK)).toBe(utc("2026-09-28T13:30:00Z"));
    expect(nextOpeningBell(utc("2026-09-26T12:00:00Z"), 1200, LOCK)).toBe(utc("2026-09-28T13:30:00Z"));
  });

  it("keeps today's open while there is still time to bet on it", () => {
    expect(nextOpeningBell(utc("2026-09-25T12:00:00Z"), 1200, LOCK)).toBe(utc("2026-09-25T13:30:00Z"));
    // Less than the lead before betting closes: move to the next session.
    expect(nextOpeningBell(utc("2026-09-25T13:10:00Z"), 1200, LOCK)).toBe(utc("2026-09-28T13:30:00Z"));
  });
});
