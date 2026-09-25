import { scheduleHolidays } from "../sessions";
import { normalizeFeedId, Stock } from "../stocks";

/** Pyth's public feed metadata, which carries each feed's market-hours schedule. */
const BENCHMARKS = "https://benchmarks.pyth.network/v1/price_feeds/";
const TTL_MS = 60 * 60 * 1000;

type FeedMeta = { id: string; attributes?: { schedule?: string } };

let cache: { at: number; holidays: Map<string, Set<string>> } | null = null;

/**
 * NY dates the stock's market is closed, read from Pyth's own schedule for
 * its equity feed, so ladders are only opened for sessions Pyth will price.
 * Throws if Pyth can't be reached; callers fall back to plain weekdays.
 */
export async function pythHolidays(stock: Stock): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS && cache.holidays.has(stock.equityFeedId)) {
    return cache.holidays.get(stock.equityFeedId)!;
  }
  const url = `${BENCHMARKS}?query=${encodeURIComponent(stock.symbol)}&asset_type=equity`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Pyth market hours returned ${res.status}`);
  const feed = ((await res.json()) as FeedMeta[]).find((f) => normalizeFeedId(f.id) === stock.equityFeedId);
  const schedule = feed?.attributes?.schedule;
  if (!schedule) throw new Error(`Pyth has no market-hours schedule for ${stock.pythSymbol}`);
  const holidays = scheduleHolidays(schedule, Date.now() / 1000);
  cache = { at: Date.now(), holidays: new Map(cache?.holidays).set(stock.equityFeedId, holidays) };
  return holidays;
}
