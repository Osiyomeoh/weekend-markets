import { describe, expect, it } from "vitest";

import { nextOpeningBell, nyTimestamp, scheduleHolidays, usSession } from "./sessions";

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

describe("usSession", () => {
  it("tells regular, extended and closed apart", () => {
    expect(usSession(utc("2026-09-24T14:00:00Z"))).toBe("regular"); // Thu 10:00 ET
    expect(usSession(utc("2026-09-24T21:08:00Z"))).toBe("extended"); // Thu 17:08 ET, after-hours
    expect(usSession(utc("2026-09-24T11:59:00Z"))).toBe("extended"); // Thu 07:59 ET, pre-market
    expect(usSession(utc("2026-09-25T04:45:00Z"))).toBe("extended"); // Fri 00:45 ET, overnight
    expect(usSession(utc("2026-09-28T13:30:00Z"))).toBe("regular"); // Mon 09:30 ET, the bell
  });

  it("is closed only from Friday 20:00 ET to Sunday 20:00 ET", () => {
    expect(usSession(utc("2026-09-25T23:59:00Z"))).toBe("extended"); // Fri 19:59 ET
    expect(usSession(utc("2026-09-26T00:00:00Z"))).toBe("closed"); // Fri 20:00 ET
    expect(usSession(utc("2026-09-26T16:00:00Z"))).toBe("closed"); // Saturday
    expect(usSession(utc("2026-09-27T23:59:00Z"))).toBe("closed"); // Sun 19:59 ET
    expect(usSession(utc("2026-09-28T00:00:00Z"))).toBe("extended"); // Sun 20:00 ET
  });
});

describe("market holidays from Pyth's schedule", () => {
  // TSLA's schedule as Pyth publishes it (Benchmarks price_feeds metadata, 25 Sep 2026).
  const SCHEDULE =
    "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300,1224/0930-1300,1225/C,0101/C,0118/C,0215/C,0326/C,0531/C,0618/C,0705/C";
  const holidays = scheduleHolidays(SCHEDULE, utc("2026-09-25T12:00:00Z"));

  it("lists closed days in the coming year, rolling past dates into next year", () => {
    expect(holidays.has("2026-11-26")).toBe(true); // Thanksgiving
    expect(holidays.has("2027-01-01")).toBe(true);
    expect(holidays.has("2027-09-07")).toBe(true); // this year's Labor Day has passed
    expect(holidays.has("2026-11-27")).toBe(false); // early close: still opens at 09:30
    expect(holidays.size).toBe(10);
  });

  it("skips a holiday when picking the next opening bell", () => {
    // Wednesday before Thanksgiving, after the bell: Thursday is closed, Friday opens.
    expect(nextOpeningBell(utc("2026-11-25T15:00:00Z"), 1200, LOCK, holidays)).toBe(utc("2026-11-27T14:30:00Z"));
    // Without the calendar it would pick Thanksgiving.
    expect(nextOpeningBell(utc("2026-11-25T15:00:00Z"), 1200, LOCK)).toBe(utc("2026-11-26T14:30:00Z"));
  });

  it("ignores a malformed schedule", () => {
    expect(scheduleHolidays("garbage", utc("2026-09-25T12:00:00Z")).size).toBe(0);
  });
});
