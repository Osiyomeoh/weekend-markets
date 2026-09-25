/**
 * Re-quotes open operator ladders to the current pricing model (gapModel.ts)
 * at the latest Pyth price, the way a market maker updates its quotes: at
 * each strike it adds stake to the side the model says is underpriced until
 * the pool's odds match the model. It only ever adds, so no one's stake is
 * touched; the operator mints the test USDC it stakes.
 *
 *   npx tsx scripts/requote.ts            # dry run: show current and target odds
 *   npx tsx scripts/requote.ts --send
 */
import "./env";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey, Transaction } from "@solana/web3.js";
import { parseArgs } from "node:util";

import { COLLATERAL_MINT, OPERATOR, RPC_URL } from "../src/lib/config";
import { tokens } from "../src/lib/format";
import { gapModel, openingHistory, sessionYearsBetween } from "../src/lib/gapModel";
import { impliedProbability } from "../src/lib/ladder";
import { fetchMarkets, getProgram, placeBetIxs } from "../src/lib/program";
import { keypairWallet } from "../src/lib/server/keypairWallet";
import { loadOperator } from "../src/lib/server/operator";
import { latestQuotes } from "../src/lib/server/pyth";
import { STOCKS } from "../src/lib/stocks";

const { values: args } = parseArgs({ options: { send: { type: "boolean", default: false } } });

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const operator = loadOperator();
  if (!operator.publicKey.equals(OPERATOR)) throw new Error("operator key does not match NEXT_PUBLIC_OPERATOR");
  const program = getProgram(connection, keypairWallet(operator));
  const now = Date.now() / 1000;
  const quotes = await latestQuotes(STOCKS.map((s) => s.equityFeedId));

  const todo = [];
  for (const m of await fetchMarkets(program, OPERATOR)) {
    if (m.status !== "open" || m.lockTs < now + 120) continue;
    const stock = STOCKS.find((s) => s.equityFeedId === m.feedId);
    const quote = quotes[m.feedId];
    if (!stock || !quote) continue;
    const years = (m.resolveTs - now) / (365 * 86_400);
    const model = gapModel(stock, years, openingHistory(stock), sessionYearsBetween(now, m.resolveTs));
    const target = Math.min(0.95, Math.max(0.05, model.probabilityAbove(quote.price, m.strike)));
    const p = impliedProbability(m) ?? 0.5;
    // Add to one side only, until yes / (yes + no) = target.
    let yes = 0n;
    let no = 0n;
    if (p < target) yes = BigInt(Math.round((target * Number(m.noPool)) / (1 - target))) - m.yesPool;
    else no = BigInt(Math.round(((1 - target) * Number(m.yesPool)) / target)) - m.noPool;
    console.log(
      `${stock.symbol} $${m.strike.toFixed(2)} @ ${new Date(m.resolveTs * 1000).toISOString()} (${model.source}, spot ${quote.price.toFixed(2)}): ` +
        `YES ${(p * 100).toFixed(1)}% -> ${(target * 100).toFixed(1)}%, add ${tokens(yes, 0)} YES ${tokens(no, 0)} NO`,
    );
    if (yes > 0n || no > 0n) todo.push({ m, yes, no });
  }
  if (!args.send || todo.length === 0) return console.log(args.send ? "nothing to re-quote" : "dry run; pass --send to stake");

  const operatorToken = getAssociatedTokenAddressSync(COLLATERAL_MINT, operator.publicKey);
  const needed = todo.reduce((a, t) => a + t.yes + t.no, 0n);
  await program.provider.sendAndConfirm!(
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, operatorToken, operator.publicKey, COLLATERAL_MINT),
      createMintToInstruction(COLLATERAL_MINT, operatorToken, operator.publicKey, needed),
    ),
    [operator],
  );
  for (const { m, yes, no } of todo) {
    const market = new PublicKey(m.address);
    const side = yes > 0n ? "yes" : "no";
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      ...(await placeBetIxs(program, { market, bettor: operator.publicKey, side, amount: yes > 0n ? yes : no })),
    );
    const sig = await program.provider.sendAndConfirm!(tx, [operator]);
    console.log(`$${m.strike.toFixed(2)}: +${tokens(yes > 0n ? yes : no, 0)} ${side.toUpperCase()} ${sig.slice(0, 12)}…`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
