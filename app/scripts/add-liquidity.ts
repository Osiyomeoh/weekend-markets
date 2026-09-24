/**
 * Deepens every open operator market to a target pool size by staking both
 * sides at the market's current odds, so prices don't move but a sizeable
 * trade (or a cover strip) moves them less. The operator is the test-USDC
 * mint authority, so it mints what it stakes.
 *
 *   npx tsx scripts/add-liquidity.ts --depth 5000
 */
import "./env";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey, Transaction } from "@solana/web3.js";
import { parseArgs } from "node:util";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT, OPERATOR, RPC_URL } from "../src/lib/config";
import { tokens } from "../src/lib/format";
import { impliedProbability } from "../src/lib/ladder";
import { fetchMarkets, getProgram, placeBetIxs } from "../src/lib/program";
import { keypairWallet } from "../src/lib/server/keypairWallet";
import { loadOperator } from "../src/lib/server/operator";

const { values: args } = parseArgs({ options: { depth: { type: "string", default: "5000" } } });

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const operator = loadOperator();
  if (!operator.publicKey.equals(OPERATOR)) throw new Error("operator key does not match NEXT_PUBLIC_OPERATOR");
  const program = getProgram(connection, keypairWallet(operator));
  const depth = BigInt(Math.round(Number(args.depth) * 10 ** COLLATERAL_DECIMALS));
  const now = Date.now() / 1000;

  const todo = (await fetchMarkets(program, OPERATOR))
    .filter((m) => m.status === "open" && m.lockTs > now + 60 && m.yesPool + m.noPool < depth)
    .map((m) => {
      const add = depth - (m.yesPool + m.noPool);
      const p = impliedProbability(m) ?? 0.5;
      const yes = BigInt(Math.round(Number(add) * p));
      return { m, yes, no: add - yes };
    });
  if (todo.length === 0) return console.log("every open market is already at depth");

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
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }));
    if (yes > 0n) tx.add(...(await placeBetIxs(program, { market, bettor: operator.publicKey, side: "yes", amount: yes })));
    if (no > 0n) tx.add(...(await placeBetIxs(program, { market, bettor: operator.publicKey, side: "no", amount: no })));
    const sig = await program.provider.sendAndConfirm!(tx, [operator]);
    console.log(`$${m.strike.toFixed(2)} @ ${new Date(m.resolveTs * 1000).toISOString()}: +${tokens(yes, 0)} YES +${tokens(no, 0)} NO ${sig.slice(0, 12)}…`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
