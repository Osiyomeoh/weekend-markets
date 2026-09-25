/**
 * Every close-to-open gap in TSLA since Pyth began serving its equity history,
 * from Pyth prints: the close is the first print at or after 16:00 ET, the open
 * the first print at or after 09:30 ET (the same rule the ladders settle on).
 * Writes src/data/tsla-gaps.json, which the landing page charts.
 *
 *   npx tsx scripts/gaps.ts
 */
import "./env";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { hermes } from "../src/lib/server/pyth";
import { nyTimestamp } from "../src/lib/sessions";
import { STOCKS } from "../src/lib/stocks";

const TSLA = STOCKS.find((s) => s.symbol === "TSLA")!;
const FIRST = { y: 2026, m: 7, d: 6 };
// NYSE holidays in range. Pyth's schedule lists upcoming closures only.
const HOLIDAYS = new Set(["2026-07-03", "2026-09-07"]);
// A print more than this far from the bell means there was no session.
const MAX_LAG_SECS = 60;
const CONCURRENCY = 6;

type Day = { y: number; m: number; d: number };
type Print = { price: number; publishTime: number };

const iso = (d: Day) => `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;

function tradingDays(until: number): Day[] {
  const out: Day[] = [];
  for (let t = Date.UTC(FIRST.y, FIRST.m - 1, FIRST.d); t / 1000 < until; t += 86_400_000) {
    const date = new Date(t);
    const day = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(iso(day))) out.push(day);
  }
  return out;
}

async function printAt(ts: number): Promise<Print | null> {
  try {
    const r = await hermes().getPriceUpdatesAtTimestamp(ts, [TSLA.equityFeedId], { parsed: true });
    const p = r.parsed![0].price;
    if (p.publish_time - ts > MAX_LAG_SECS) return null;
    return { price: Number(p.price) * 10 ** p.expo, publishTime: p.publish_time };
  } catch {
    return null; // before Pyth's history starts
  }
}

async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  const now = Date.now() / 1000;
  const days = tradingDays(now);
  const sessions = (
    await pool(days, async (day) => {
      const [open, close] = await Promise.all([
        nyTimestamp(day, 9, 30) <= now ? printAt(nyTimestamp(day, 9, 30)) : null,
        nyTimestamp(day, 16, 0) <= now ? printAt(nyTimestamp(day, 16, 0)) : null,
      ]);
      return { date: iso(day), open, close };
    })
  ).filter((s) => s.open || s.close);

  const gaps = sessions.slice(1).flatMap((s, i) => {
    const prev = sessions[i];
    if (!prev.close || !s.open) return [];
    const hours = (s.open.publishTime - prev.close.publishTime) / 3600;
    return [
      {
        from: prev.date,
        to: s.date,
        close: prev.close.price,
        open: s.open.price,
        gap: s.open.price / prev.close.price - 1,
        // Anything longer than a weeknight: a weekend or a holiday.
        weekend: hours > 24,
      },
    ];
  });

  const out = {
    source: `Pyth ${TSLA.pythSymbol}: first print at or after 16:00 ET (close) and 09:30 ET (open)`,
    generatedAt: new Date().toISOString(),
    gaps,
  };
  writeFileSync(join(__dirname, "..", "src", "data", "tsla-gaps.json"), JSON.stringify(out, null, 1) + "\n");

  const pctAbs = (xs: number[]) => (xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length) * 100;
  const weekend = gaps.filter((g) => g.weekend).map((g) => g.gap);
  const nights = gaps.filter((g) => !g.weekend).map((g) => g.gap);
  console.log(`${sessions.length} sessions from ${sessions[0]?.date}, ${gaps.length} gaps`);
  console.log(`weekends/holidays: ${weekend.length}, mean |gap| ${pctAbs(weekend).toFixed(2)}%`);
  console.log(`weeknights: ${nights.length}, mean |gap| ${pctAbs(nights).toFixed(2)}%`);
  for (const g of gaps.filter((g) => g.weekend)) console.log(`  ${g.from} -> ${g.to}: ${(g.gap * 100).toFixed(2)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
