/**
 * End-to-end check of the user flow against a running app: a brand-new wallet
 * asks the faucet for test funds, then buys cover on the latest open TSLA
 * ladder with the same instructions the UI builds, signed locally and sent to
 * devnet. Prints the resulting positions.
 *
 *   npx tsx scripts/smoke.ts --url https://weekend-markets.vercel.app
 */
import "./env";

import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { parseArgs } from "node:util";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT, explorerTx, OPERATOR, RPC_URL } from "../src/lib/config";
import { coverPlan } from "../src/lib/cover";
import { tokens, usd } from "../src/lib/format";
import { currentPayout, groupSeries } from "../src/lib/ladder";
import { fetchMarkets, fetchPositions, getProgram, placeBetIxs } from "../src/lib/program";
import { STOCKS } from "../src/lib/stocks";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    shares: { type: "string", default: "10" },
  },
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${args.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error}`);
  return json;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const program = getProgram(connection);
  const user = Keypair.generate();
  console.log(`wallet ${user.publicKey.toBase58()}`);

  const drip = await post("/api/faucet", { owner: user.publicKey.toBase58() });
  console.log(`faucet: ${tokens(BigInt(drip.tokens), 0)} tUSDC + ${drip.lamports / 1e9} SOL`, explorerTx(drip.signature));

  const tsla = STOCKS.find((s) => s.symbol === "TSLA")!;
  const quotes = (await (await fetch(`${args.url}/api/prices`)).json()).quotes;
  const spot: number = quotes[tsla.equityFeedId].price;
  const now = Date.now() / 1000;
  const series = groupSeries(await fetchMarkets(program, OPERATOR))
    .filter((s) => s.feedId === tsla.equityFeedId && s.lockTs > now + 30)
    .at(-1);
  if (!series) throw new Error("no open TSLA ladder");

  const from = series.markets
    .map((m) => m.strike)
    .filter((k) => k <= spot * 0.99)
    .sort((a, b) => b - a)[0];
  const plan = coverPlan(series.markets, spot, Number(args.shares), 10 ** COLLATERAL_DECIMALS, { from });
  console.log(`cover ${args.shares} TSLA from ${usd(spot)}: ${plan.legs.length} legs, cost ${tokens(plan.cost)}, pays up to ${tokens(plan.maxPayout)}`);

  const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, user.publicKey);
  const legs = await Promise.all(
    plan.legs.map((l) =>
      placeBetIxs(program, { market: new PublicKey(l.market.address), bettor: user.publicKey, side: "no", amount: l.stake }),
    ),
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: user.publicKey, blockhash, lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(user.publicKey, ata, user.publicKey, COLLATERAL_MINT),
    ...legs.flat(),
  );
  tx.sign(user);
  const signature = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`bought cover (${tx.serialize().length} bytes)`, explorerTx(signature));

  const markets = new Map((await fetchMarkets(program, OPERATOR)).map((m) => [m.address, m]));
  for (const p of await fetchPositions(program, user.publicKey)) {
    const m = markets.get(p.market)!;
    console.log(`  NO ${tokens(p.noAmount)} on >= ${usd(m.strike)}: pays ~${tokens(currentPayout(m, "no", p.noAmount))} below it`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
