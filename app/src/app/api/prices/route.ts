import { latestQuotes, Quote } from "@/lib/server/pyth";
import { STOCKS } from "@/lib/stocks";

export const dynamic = "force-dynamic";

// Hermes calls are keyed and metered, so every visitor shares one recent result.
let cache: { at: number; quotes: Record<string, Quote> } | null = null;
const TTL_MS = 4_000;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const ids = STOCKS.flatMap((s) => [s.equityFeedId, s.xstockFeedId]);
      cache = { at: Date.now(), quotes: await latestQuotes(ids) };
    }
    return Response.json(
      { quotes: cache.quotes, serverTime: Math.floor(Date.now() / 1000) },
      { headers: { "Cache-Control": "public, s-maxage=4, stale-while-revalidate=10" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
