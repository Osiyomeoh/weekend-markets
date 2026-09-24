import { Connection, PublicKey } from "@solana/web3.js";

import { RPC_URL } from "@/lib/config";
import { settleLadder } from "@/lib/server/keeper";
import { loadOperator } from "@/lib/server/operator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MARKETS = 12;

/**
 * Settles due markets: `{ "markets": [address, ...] }` (or `{ "market": address }`).
 * Strikes of one ladder share a single posted Pyth update. The program makes
 * settlement permissionless and checks the price itself; this route only
 * saves the caller the fees and the Pyth API call.
 */
export async function POST(request: Request) {
  let markets: PublicKey[];
  try {
    const body = (await request.json()) as { market?: unknown; markets?: unknown };
    const list = Array.isArray(body.markets) ? body.markets : [body.market];
    if (list.length === 0 || list.length > MAX_MARKETS || !list.every((m) => typeof m === "string")) throw new Error();
    markets = [...new Set(list as string[])].map((m) => new PublicKey(m));
  } catch {
    return Response.json({ error: `markets must be 1 to ${MAX_MARKETS} addresses` }, { status: 400 });
  }

  try {
    const r = await settleLadder(new Connection(RPC_URL, "confirmed"), loadOperator(), markets);
    const settled = r.resolved.length + r.voided.length;
    if (settled === 0 && r.pending.length > 0) {
      // Nothing moved: most often the Pyth print for the deadline isn't published yet.
      return Response.json({ error: r.pending[0].reason, pending: r.pending }, { status: 425 });
    }
    return Response.json({
      resolved: r.resolved.map((m) => m.address),
      voided: r.voided.map((m) => m.address),
      pending: r.pending,
      signatures: r.signatures,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
