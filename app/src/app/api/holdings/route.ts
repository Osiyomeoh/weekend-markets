import { PublicKey } from "@solana/web3.js";

import { Holding, mainnetHoldings } from "@/lib/server/holdings";

export const dynamic = "force-dynamic";

// The public mainnet RPC is rate limited; remember recent lookups briefly.
const cache = new Map<string, { at: number; holdings: Holding[] }>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

/** GET /api/holdings?owner=<address>: tokenized stocks the address holds on mainnet. */
export async function GET(request: Request) {
  let owner: PublicKey;
  try {
    owner = new PublicKey(new URL(request.url).searchParams.get("owner") ?? "");
  } catch {
    return Response.json({ error: "owner must be an address" }, { status: 400 });
  }

  const key = owner.toBase58();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json({ holdings: hit.holdings });

  try {
    const holdings = await mainnetHoldings(owner);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), holdings });
    return Response.json({ holdings });
  } catch (e) {
    return Response.json({ error: `mainnet lookup failed: ${(e as Error).message}` }, { status: 502 });
  }
}
