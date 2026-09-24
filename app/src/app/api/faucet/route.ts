import { Connection, PublicKey } from "@solana/web3.js";

import { RPC_URL } from "@/lib/config";
import { drip } from "@/lib/server/faucet";
import { loadOperator } from "@/lib/server/operator";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let owner: PublicKey;
  try {
    const body = (await request.json()) as { owner?: unknown };
    if (typeof body.owner !== "string") throw new Error();
    owner = new PublicKey(body.owner);
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error();
  } catch {
    return Response.json({ error: "owner must be a wallet address" }, { status: 400 });
  }

  try {
    const r = await drip(new Connection(RPC_URL, "confirmed"), loadOperator(), owner);
    return Response.json({
      signature: r.signature,
      tokens: r.tokens.toString(),
      lamports: r.lamports,
      alreadyFunded: r.signature === null,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
