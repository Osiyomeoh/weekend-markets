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

export async function voidMarket(connection: Connection, operator: Keypair, market: PublicKey): Promise<SettleResult> {
  const program = getProgram(connection, keypairWallet(operator));
  const tx = new Transaction().add(await voidIx(program, market));
  const sig = await program.provider.sendAndConfirm!(tx, [operator], { commitment: "confirmed" });
  return { action: "voided", signatures: [sig], market: await fetchMarket(program, market) };
}
