import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT } from "../config";

const DRIP = 1_000n * 10n ** BigInt(COLLATERAL_DECIMALS);
const REFILL_BELOW = 100n * 10n ** BigInt(COLLATERAL_DECIMALS);
const SOL_DRIP = 0.05 * LAMPORTS_PER_SOL;
const SOL_REFILL_BELOW = 0.02 * LAMPORTS_PER_SOL;

export type DripResult = { signature: string | null; tokens: bigint; lamports: number };

/**
 * Devnet faucet. Stateless rate limit: a wallet only gets test USDC when it
 * holds less than 100, and SOL for fees when it holds less than 0.02.
 */
export async function drip(connection: Connection, operator: Keypair, owner: PublicKey): Promise<DripResult> {
  const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, owner);
  const [tokenBalance, solBalance] = await Promise.all([
    connection
      .getTokenAccountBalance(ata)
      .then((b) => BigInt(b.value.amount))
      .catch(() => 0n),
    connection.getBalance(owner),
  ]);

  const tx = new Transaction();
  let tokens = 0n;
  let lamports = 0;
  if (tokenBalance < REFILL_BELOW) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ata, owner, COLLATERAL_MINT),
      createMintToInstruction(COLLATERAL_MINT, ata, operator.publicKey, DRIP),
    );
    tokens = DRIP;
  }
  if (solBalance < SOL_REFILL_BELOW) {
    tx.add(SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: owner, lamports: SOL_DRIP }));
    lamports = SOL_DRIP;
  }
  if (tx.instructions.length === 0) return { signature: null, tokens, lamports };

  const signature = await sendAndConfirmTransaction(connection, tx, [operator], { commitment: "confirmed" });
  return { signature, tokens, lamports };
}
