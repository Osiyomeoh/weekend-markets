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
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
    })
      .formatToParts(new Date(unix * 1000))
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday: parts.weekday };
}

const isoDate = (d: { y: number; m: number; d: number }) =>
  `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;

/**
 * The NY dates a Pyth market-hours schedule lists as closed, e.g. from
 * "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1126/C,1127/0930-1300".
 * Holiday entries carry no year, so each is taken as its next occurrence on or
 * after `from`. Early-close days still open at 09:30, so they aren't included.
 */
export function scheduleHolidays(schedule: string, from: number): Set<string> {
  const today = nyDate(from);
  const out = new Set<string>();
  for (const entry of (schedule.split(";")[2] ?? "").split(",")) {
    const [mmdd, hours] = entry.trim().split("/");
    if (hours !== "C" || !/^\d{4}$/.test(mmdd)) continue;
    const m = Number(mmdd.slice(0, 2));
    const d = Number(mmdd.slice(2));
    const y = m * 100 + d >= today.m * 100 + today.d ? today.y : today.y + 1;
    out.add(isoDate({ y, m, d }));
  }
  return out;
}

/**
 * The next weekday 09:30 ET opening bell whose betting (closing `lockBeforeSecs`
 * earlier) is still at least `leadSecs` away, skipping `holidays` (NY dates, from
 * Pyth's market-hours schedule via `scheduleHolidays`). Without them, a ladder
 * on a holiday gets no print and voids, refunding everyone.
 */
export function nextOpeningBell(
  now: number,
  leadSecs: number,
  lockBeforeSecs: number,
  holidays: ReadonlySet<string> = new Set(),
): number {
  for (let day = 0; day < 14; day++) {
    const date = nyDate(now + day * 86_400);
    if (date.weekday === "Sat" || date.weekday === "Sun" || holidays.has(isoDate(date))) continue;
    const ts = nyTimestamp(date, 9, 30);
    if (ts - lockBeforeSecs >= now + leadSecs) return ts;
  }
  throw new Error("no opening bell in the next 14 days");
}

export type Session = "regular" | "extended" | "closed";

/**
 * US equity session at a moment. Regular: 09:30-16:00 ET on weekdays.
 * Extended: pre-market, after-hours and the overnight venues, which run
 * Sunday 20:00 ET to Friday 20:00 ET outside the regular session. Closed:
 * Friday 20:00 ET to Sunday 20:00 ET, when nothing trades US stocks.
 * Exchange holidays aren't modeled.
 */
export function usSession(unix: number): Session {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    })
      .formatToParts(new Date(unix * 1000))
      .map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const evening = minutes >= 20 * 60;
  if (parts.weekday === "Sat") return "closed";
  if (parts.weekday === "Sun") return evening ? "extended" : "closed";
  if (parts.weekday === "Fri" && evening) return "closed";
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60 ? "regular" : "extended";
}
