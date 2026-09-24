import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * The operator wallet creates markets, runs the faucet and pays fees to post
 * settlement prices. It has no special power in the program: `resolve` and
 * `void_market` are permissionless, and it cannot touch anyone's stake.
 *
 * Loaded from OPERATOR_SECRET_KEY (base58 or JSON byte array) or, for local
 * development, OPERATOR_KEYPAIR_PATH.
 */
export function loadOperator(): Keypair {
  const secret = process.env.OPERATOR_SECRET_KEY?.trim();
  if (secret) {
    const bytes = secret.startsWith("[") ? Uint8Array.from(JSON.parse(secret)) : bs58.decode(secret);
    return Keypair.fromSecretKey(bytes);
  }
  const path = process.env.OPERATOR_KEYPAIR_PATH;
  if (path) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  }
  throw new Error("Set OPERATOR_SECRET_KEY or OPERATOR_KEYPAIR_PATH");
}
