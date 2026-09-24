import { Connection, PublicKey } from "@solana/web3.js";

import { RPC_URL } from "@/lib/config";
import { settleMarket } from "@/lib/server/keeper";
import { loadOperator } from "@/lib/server/operator";
import { NotYetPublished } from "@/lib/server/pyth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Settles one due market. The program makes settlement permissionless and
 * checks the price itself; this route only saves the caller the fees and the
 * Pyth API call.
 */
export async function POST(request: Request) {
  let market: PublicKey;
  try {
    const body = (await request.json()) as { market?: unknown };
    if (typeof body.market !== "string") throw new Error();
    market = new PublicKey(body.market);
  } catch {
    return Response.json({ error: "market must be an address" }, { status: 400 });
  }

  try {
    const r = await settleMarket(new Connection(RPC_URL, "confirmed"), loadOperator(), market);
    return Response.json({ action: r.action, signatures: r.signatures });
  } catch (e) {
    const status = e instanceof NotYetPublished ? 425 : 409;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
