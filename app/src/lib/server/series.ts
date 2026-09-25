import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, Transaction } from "@solana/web3.js";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT } from "../config";
import { gapModel, ladderOdds, openingHistory, seedSplit } from "../gapModel";
import { DEFAULT_LADDER, strikeToOnChain } from "../ladder";
import { createMarketIx, getProgram, marketPda, placeBetIxs } from "../program";
import { Stock, STOCKS } from "../stocks";
import { keypairWallet } from "./keypairWallet";

export type LadderSpec = {
  stock: Stock;
  resolveTs: number;
  lockBeforeSecs: number;
  strikes: number;
  /** Seed stake per market, split YES/NO at model odds. */
  seed: number;
  windowSecs: number;
  voidDelaySecs: number;
  maxConfBps: number;
};

export { DEFAULT_LADDER };

/** Deterministic id, so creating the same ladder twice is a no-op. */
export function ladderMarketId(stock: Stock, resolveTs: number, index: number): bigint {
  return BigInt(resolveTs) * 1000n + BigInt(STOCKS.indexOf(stock) * 100 + index);
}

/** Whether the ladder's first strike already exists on-chain. */
export async function ladderExists(connection: Connection, operator: Keypair, stock: Stock, resolveTs: number): Promise<boolean> {
  return (await connection.getAccountInfo(marketPda(operator.publicKey, ladderMarketId(stock, resolveTs, 0)))) !== null;
}

/**
 * Creates a strike ladder around `spot` and seeds every market at model odds,
 * so it opens with a price: from the stock's history of opening moves once it
 * has enough of them, otherwise lognormal (see gapModel.ts). Strikes are
 * spaced about 0.6 standard deviations apart. Markets that already exist are
 * skipped.
 */
export async function createLadder(
  connection: Connection,
  operator: Keypair,
  spec: LadderSpec,
  spot: number,
): Promise<{ created: { strike: number; market: string }[]; skipped: number }> {
  const program = getProgram(connection, keypairWallet(operator));
  const { stock, resolveTs } = spec;
  const lockTs = resolveTs - spec.lockBeforeSecs;
  if (lockTs <= Date.now() / 1000 + 30) throw new Error("lock time must be at least 30s in the future");
  if (spec.strikes < 1 || spec.strikes % 2 === 0) throw new Error("strikes must be odd");

  const years = (resolveTs - Date.now() / 1000) / (365 * 86_400);
  const odds = ladderOdds(gapModel(stock, years, openingHistory(stock)), spot, stock.tick, spec.strikes);
  const seed = BigInt(Math.round(spec.seed * 10 ** COLLATERAL_DECIMALS));

  const plans = [];
  for (const [index, { strike, p }] of odds.entries()) {
    const { price, expo } = strikeToOnChain(strike);
    const { market, ix } = await createMarketIx(program, {
      creator: operator.publicKey,
      marketId: ladderMarketId(stock, resolveTs, index),
      feedId: stock.equityFeedId,
      strikePrice: price,
      strikeExpo: expo,
      lockTs,
      resolveTs,
      resolveWindowSecs: spec.windowSecs,
      voidDelaySecs: spec.voidDelaySecs,
      maxConfBps: spec.maxConfBps,
    });
    if (await connection.getAccountInfo(market)) continue;
    plans.push({ strike, market, ix, ...seedSplit(seed, p) });
  }
  if (plans.length === 0) return { created: [], skipped: spec.strikes };

  // The operator is the test-USDC mint authority: mint exactly what seeding needs.
  const operatorToken = getAssociatedTokenAddressSync(COLLATERAL_MINT, operator.publicKey);
  const needed = plans.reduce((a, p) => a + p.yes + p.no, 0n);
  const have = await connection
    .getTokenAccountBalance(operatorToken)
    .then((b) => BigInt(b.value.amount))
    .catch(() => 0n);
  if (have < needed) {
    await program.provider.sendAndConfirm!(
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, operatorToken, operator.publicKey, COLLATERAL_MINT),
        createMintToInstruction(COLLATERAL_MINT, operatorToken, operator.publicKey, needed - have),
      ),
      [operator],
    );
  }

  const created = [];
  for (const p of plans) {
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
      p.ix,
      ...(await placeBetIxs(program, { market: p.market, bettor: operator.publicKey, side: "yes", amount: p.yes })),
      ...(await placeBetIxs(program, { market: p.market, bettor: operator.publicKey, side: "no", amount: p.no })),
    );
    await program.provider.sendAndConfirm!(tx, [operator]);
    created.push({ strike: p.strike, market: p.market.toBase58() });
  }
  return { created, skipped: spec.strikes - plans.length };
}
