import { PublicKey } from "@solana/web3.js";

import { cachedPositions, toJson } from "@/lib/server/chainReads";

export const dynamic = "force-dynamic";

/** Positions held by `?owner=`, shared by all visitors (see chainReads.ts). */
export async function GET(request: Request) {
  let owner: PublicKey;
  try {
    owner = new PublicKey(new URL(request.url).searchParams.get("owner") ?? "");
  } catch {
    return Response.json({ error: "owner must be a Solana address" }, { status: 400 });
  }
  try {
    const { data, stale } = await cachedPositions(owner);
    return new Response(toJson({ positions: data, stale }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=2, stale-while-revalidate=30",
      },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
