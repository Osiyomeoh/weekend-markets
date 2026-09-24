import { timingSafeEqual } from "node:crypto";

import { Connection } from "@solana/web3.js";

import { RPC_URL } from "@/lib/config";
import { runTick } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const got = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Keeps the app running without anyone at a laptop. Called every few minutes
 * by a scheduler (see .github/workflows/keeper.yml). The work is in
 * `lib/server/tick.ts`; `npm run tick` runs the same pass locally.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await runTick(new Connection(RPC_URL, "confirmed")));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
