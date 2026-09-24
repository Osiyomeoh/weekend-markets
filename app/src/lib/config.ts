import { PublicKey } from "@solana/web3.js";

export const CLUSTER = "devnet" as const;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey("2oihGq9YRDQkgeEXwrzGcgs9UjDZVUKeKZCP81UkTSN9");

/** Test USDC minted by our faucet on devnet. Not real money. */
export const COLLATERAL_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_COLLATERAL_MINT || "4HbeqsK5hFEFpLJNHEs1kz5CSePjF3k6qqwzuTPfE35Q",
);
export const COLLATERAL_DECIMALS = 6;
export const COLLATERAL_SYMBOL = "tUSDC";

/** Only markets created by this wallet are listed in the app. */
export const OPERATOR = new PublicKey(
  process.env.NEXT_PUBLIC_OPERATOR || "955ZtZxaANGiNrUZahGNxBY3rKhTBSkCYqG94EAerV1Y",
);

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`;
}
