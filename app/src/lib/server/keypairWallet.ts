import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * Anchor-compatible wallet backed by a keypair. Anchor's own `Wallet` is only
 * exported from its Node build, which Next's bundler doesn't always pick.
 */
export function keypairWallet(payer: Keypair) {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([payer]);
    else tx.partialSign(payer);
    return tx;
  };
  return {
    payer,
    publicKey: payer.publicKey as PublicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => sign(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs.map(sign),
  };
}
