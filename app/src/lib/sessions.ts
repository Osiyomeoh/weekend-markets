/** Market-session times in New York, computed from the tz database (no dependencies). */

const NY = "America/New_York";

/** Unix seconds for a wall-clock time in New York on a given NY calendar date. */
export function nyTimestamp(date: { y: number; m: number; d: number }, hour: number, minute: number): number {
  const naive = Date.UTC(date.y, date.m - 1, date.d, hour, minute) / 1000;
  // New York's UTC offset on that date (EDT -4 or EST -5), read from the tz database.
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: NY, timeZoneName: "shortOffset" })
    .formatToParts(new Date((naive + 5 * 3600) * 1000))
    .find((p) => p.type === "timeZoneName")!
    .value.replace("GMT", "");
  const [h, m = "0"] = (offset || "+0").split(":");
  const offsetSecs = Number(h) * 3600 + Math.sign(Number(h) || 1) * Number(m) * 60;
  return naive - offsetSecs;
}

/** The NY calendar date and weekday of a unix time. */
function nyDate(unix: number): { y: number; m: number; d: number; weekday: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      .formatToParts(new Date(unix * 1000))
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday: parts.weekday };
}

/**
 * The next weekday 09:30 ET opening bell whose betting (closing `lockBeforeSecs`
 * earlier) is still at least `leadSecs` away. Exchange holidays aren't modeled:
 * with no print that morning the ladder voids and refunds.
 */
export function nextOpeningBell(now: number, leadSecs: number, lockBeforeSecs: number): number {
  for (let day = 0; day < 10; day++) {
    const date = nyDate(now + day * 86_400);
    if (date.weekday === "Sat" || date.weekday === "Sun") continue;
    const ts = nyTimestamp(date, 9, 30);
    if (ts - lockBeforeSecs >= now + leadSecs) return ts;
  }
  throw new Error("no opening bell in the next 10 days");
}
