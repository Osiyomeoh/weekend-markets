/**
 * One-time devnet setup: operator wallet, its SOL, and the test-USDC mint.
 * Idempotent: re-running reuses what already exists.
 *
 *   npx tsx scripts/setup-devnet.ts
 */
import { APP_DIR, REPO_DIR, upsertEnv } from "./env";

import { createMint } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const OPERATOR_PATH = join(REPO_DIR, "keys", "operator.json");
const OPERATOR_TARGET_SOL = 3;

function readKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const deployer = readKeypair(join(homedir(), ".config", "solana", "id.json"));

  mkdirSync(join(REPO_DIR, "keys"), { recursive: true });
  if (!existsSync(OPERATOR_PATH)) {
    writeFileSync(OPERATOR_PATH, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
    console.log("created operator keypair", OPERATOR_PATH);
  }
  const operator = readKeypair(OPERATOR_PATH);
  console.log("operator", operator.publicKey.toBase58());

  const balance = await connection.getBalance(operator.publicKey);
  const topUp = OPERATOR_TARGET_SOL * LAMPORTS_PER_SOL - balance;
  if (topUp > 0.1 * LAMPORTS_PER_SOL) {
    const sig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: operator.publicKey, lamports: topUp }),
      ),
      [deployer],
    );
    console.log(`funded operator with ${(topUp / LAMPORTS_PER_SOL).toFixed(3)} SOL`, sig);
  }

  let mint = process.env.NEXT_PUBLIC_COLLATERAL_MINT;
  if (!mint || !(await connection.getAccountInfo(new PublicKey(mint)))) {
    const created = await createMint(connection, operator, operator.publicKey, null, 6);
    mint = created.toBase58();
    console.log("created test USDC mint", mint);
  }

  upsertEnv({
    NEXT_PUBLIC_RPC_URL: RPC,
    NEXT_PUBLIC_COLLATERAL_MINT: mint,
    NEXT_PUBLIC_OPERATOR: operator.publicKey.toBase58(),
    OPERATOR_KEYPAIR_PATH: OPERATOR_PATH,
  });
  console.log("wrote", join(APP_DIR, ".env.local"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
