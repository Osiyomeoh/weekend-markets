import {
  PRO_COMPATIBLE_PUSH_ORACLE_PROGRAM_ID,
  PRO_COMPATIBLE_RECEIVER_PROGRAM_ID,
  PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID,
  PythSolanaReceiver,
} from "@pythnetwork/pyth-solana-receiver";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { fetchMarket, getProgram, resolveIx, voidIx } from "../program";
import { MarketView } from "../ladder";
import { NoPrintInWindow, settlementUpdate } from "./pyth";
import { keypairWallet } from "./keypairWallet";

export type SettleResult =
  | { action: "resolved"; signatures: string[]; market: MarketView }
  | { action: "voided"; signatures: string[]; market: MarketView };

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Settles a market that is due. Posts the Pyth update that is the first print
 * at or after `resolve_ts` and calls `resolve` in the same transaction set,
 * then closes the temporary Pyth accounts to recover rent.
 *
 * Anyone can do this; the operator just pays the fees so users don't have to.
 */
export async function settleMarket(connection: Connection, operator: Keypair, market: PublicKey): Promise<SettleResult> {
  const wallet = keypairWallet(operator);
  const program = getProgram(connection, wallet);
  const m = await fetchMarket(program, market);
  if (m.status !== "open") throw new Error(`market is already ${m.status}`);

  // Nothing to settle against: refund immediately.
  if (nowSecs() >= m.lockTs && (m.yesPool === 0n || m.noPool === 0n)) {
    return voidMarket(connection, operator, market);
  }
  if (nowSecs() < m.resolveTs) throw new Error(`market resolves at ${m.resolveTs}, not yet`);

  let update;
  try {
    update = await settlementUpdate(m.feedId, m.resolveTs, m.resolveWindowSecs);
  } catch (e) {
    if (e instanceof NoPrintInWindow) {
      // No valid price exists; void_market becomes callable after the void delay.
      throw new Error(`${e.message}. The market can be voided after its void delay.`);
    }
    throw e;
  }

  const receiver = new PythSolanaReceiver({
    connection,
    // The receiver SDK bundles an older Anchor; the wallet shape is identical.
    wallet: wallet as never,
    receiverProgramId: PRO_COMPATIBLE_RECEIVER_PROGRAM_ID,
    wormholeProgramId: PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID,
    pushOracleProgramId: PRO_COMPATIBLE_PUSH_ORACLE_PROGRAM_ID,
  });
  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await builder.addPostPriceUpdates(update.data);
  await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => [
    { instruction: await resolveIx(program, market, getPriceUpdateAccount(m.feedId)), signers: [] },
  ]);
  const txs = await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 50_000,
    tightComputeBudget: true,
  });
  const signatures = await receiver.provider.sendAll(txs, { commitment: "confirmed" });
  return { action: "resolved", signatures, market: await fetchMarket(program, market) };
}

export type LadderResult = {
  resolved: MarketView[];
  voided: MarketView[];
  /** Markets that couldn't be settled yet, with the reason. */
  pending: { market: string; reason: string }[];
  signatures: string[];
};

/**
 * Settles every due market in `markets` with as few transactions as possible:
 * strikes that share a feed and a deadline (a ladder) share one posted Pyth
 * update, and every `resolve` reads it. One-sided markets are voided.
 */
export async function settleLadder(connection: Connection, operator: Keypair, markets: PublicKey[]): Promise<LadderResult> {
  const wallet = keypairWallet(operator);
  const program = getProgram(connection, wallet);
  const views = await Promise.all(markets.map((m) => fetchMarket(program, m)));
  const now = nowSecs();
  const result: LadderResult = { resolved: [], voided: [], pending: [], signatures: [] };

  const open = views.filter((m) => m.status === "open");
  const oneSided = open.filter((m) => now >= m.lockTs && (m.yesPool === 0n || m.noPool === 0n));
  const due = open.filter((m) => !oneSided.includes(m) && now >= m.resolveTs);
  for (const m of open.filter((m) => !oneSided.includes(m) && !due.includes(m))) {
    result.pending.push({ market: m.address, reason: `resolves at ${m.resolveTs}` });
  }

  if (oneSided.length > 0) {
    const tx = new Transaction();
    for (const m of oneSided) tx.add(await voidIx(program, new PublicKey(m.address)));
    result.signatures.push(await program.provider.sendAndConfirm!(tx, [operator], { commitment: "confirmed" }));
  }

  const groups = new Map<string, MarketView[]>();
  for (const m of due) {
    const key = `${m.feedId}:${m.resolveTs}:${m.resolveWindowSecs}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const group of groups.values()) {
    const { feedId, resolveTs, resolveWindowSecs } = group[0];
    let update;
    try {
      update = await settlementUpdate(feedId, resolveTs, resolveWindowSecs);
    } catch (e) {
      for (const m of group) result.pending.push({ market: m.address, reason: (e as Error).message });
      continue;
    }
    const receiver = new PythSolanaReceiver({
      connection,
      wallet: wallet as never,
      receiverProgramId: PRO_COMPATIBLE_RECEIVER_PROGRAM_ID,
      wormholeProgramId: PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID,
      pushOracleProgramId: PRO_COMPATIBLE_PUSH_ORACLE_PROGRAM_ID,
    });
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
    await builder.addPostPriceUpdates(update.data);
    await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) =>
      Promise.all(
        group.map(async (m) => ({
          instruction: await resolveIx(program, new PublicKey(m.address), getPriceUpdateAccount(feedId)),
          signers: [],
        })),
      ),
    );
    const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000, tightComputeBudget: true });
    result.signatures.push(...(await receiver.provider.sendAll(txs, { commitment: "confirmed" })));
  }

  const after = await Promise.all([...oneSided, ...due].map((m) => fetchMarket(program, new PublicKey(m.address))));
  result.voided = after.filter((m) => m.status === "voided");
  result.resolved = after.filter((m) => m.status === "resolved");
  for (const m of after.filter((m) => m.status === "open")) {
    if (!result.pending.some((p) => p.market === m.address)) result.pending.push({ market: m.address, reason: "still open" });
  }
  return result;
}

export async function voidMarket(connection: Connection, operator: Keypair, market: PublicKey): Promise<SettleResult> {
  const program = getProgram(connection, keypairWallet(operator));
  const tx = new Transaction().add(await voidIx(program, market));
  const sig = await program.provider.sendAndConfirm!(tx, [operator], { commitment: "confirmed" });
  return { action: "voided", signatures: [sig], market: await fetchMarket(program, market) };
}
