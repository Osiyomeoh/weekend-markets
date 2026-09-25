import { tokenizedPrices, TokenPrice } from "@/lib/server/tokenPrices";

export const dynamic = "force-dynamic";

// Every visitor shares one recent result.
let cache: { at: number; prices: Record<string, TokenPrice> } | null = null;
const TTL_MS = 15_000;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), prices: await tokenizedPrices() };
    return Response.json(
      { prices: cache.prices, at: Math.floor(cache.at / 1000) },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
