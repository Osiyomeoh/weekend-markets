import { PublicKey } from "@solana/web3.js";

import { preStockHoldings, preStocks } from "@/lib/server/prestocks";

export const dynamic = "force-dynamic";

/** GET /api/prestocks[?owner=<address>]: PreStocks tokens against their marks, and what `owner` holds. */
export async function GET(request: Request) {
  try {
    const tokens = await preStocks();
    const owner = new URL(request.url).searchParams.get("owner");
    let holdings = null;
    if (owner) {
      try {
        holdings = await preStockHoldings(new PublicKey(owner), tokens);
      } catch {
        holdings = null; // an unreadable wallet shouldn't hide the table
      }
    }
    return Response.json(
      { tokens, holdings, at: Math.floor(Date.now() / 1000) },
      { headers: { "Cache-Control": owner ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
