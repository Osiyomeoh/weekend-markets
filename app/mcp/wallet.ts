/**
 * The local agent's own devnet wallet: create it, fund it, buy cover with it
 * under a spending cap, follow it and claim. Only the local MCP server imports
 * this; the hosted endpoint holds no keys and never touches the filesystem.
 */
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { COLLATERAL_SYMBOL, explorerTx } from "../src/lib/config";
import { positionPayout } from "../src/lib/ladder";
import { claimManyIxs, fetchPositions, getProgram } from "../src/lib/program";
import {
  allMarkets,
  apiOk,
  connection,
  CoverArgs,
  coverIxs,
  describePlan,
  money,
  planCover,
  positionsOf,
  tokenBalance,
  UNIT,
} from "./agent";

const CLAIMS_PER_TX = 6;
/** Rent for up to five position accounts plus fees. */
const MIN_SOL = 0.02;

/** The agent's wallet file: keys/agent.json at the repo root unless AGENT_KEYPAIR says otherwise. */
export const keypairPath = () =>
  resolve(process.env.AGENT_KEYPAIR || join(__dirname, "..", "..", "keys", "agent.json"));
/** Most the agent may spend on one purchase, in tUSDC. Set by the person running it. */
export const MAX_SPEND = Number(process.env.AGENT_MAX_SPEND || 100);
// A cap that isn't a positive number would compare false against every cost; refuse to start instead.
if (!(MAX_SPEND > 0))
  throw new Error(`AGENT_MAX_SPEND must be a positive number of tUSDC, not "${process.env.AGENT_MAX_SPEND}"`);

function loadWallet(): { keypair: Keypair; created: boolean } {
  const path = keypairPath();
  if (existsSync(path)) {
    const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
    return { keypair: Keypair.fromSecretKey(secret), created: false };
  }
  const keypair = Keypair.generate();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...keypair.secretKey]), { mode: 0o600 });
  return { keypair, created: true };
}

async function send(ixs: TransactionInstruction[], signer: Keypair): Promise<string> {
  return sendAndConfirmTransaction(await connection(), new Transaction().add(...ixs), [signer], {
    commitment: "confirmed",
  });
}

export async function wallet(): Promise<string> {
  const { keypair, created } = loadWallet();
  const c = await connection();
  const [lamports, balance] = await Promise.all([c.getBalance(keypair.publicKey), tokenBalance(keypair.publicKey)]);
  return [
    created ? `Created a new devnet wallet for this agent at ${keypairPath()}.` : null,
    `Agent wallet: ${keypair.publicKey.toBase58()} (Solana devnet)`,
    `Balance: ${money(balance)} and ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
    `Spending cap: ${MAX_SPEND} ${COLLATERAL_SYMBOL} per purchase, set by whoever runs this agent.`,
    balance === 0n ? "No test funds yet: call get_test_funds." : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getTestFunds(): Promise<string> {
  const { keypair } = loadWallet();
  const r = await apiOk<{ signature: string | null; tokens: string; lamports: number; alreadyFunded: boolean }>(
    "/api/faucet",
    { owner: keypair.publicKey.toBase58() },
  );
  if (r.alreadyFunded) return `This wallet already has test funds.\n${await wallet()}`;
  return [
    `Received ${money(BigInt(r.tokens))}${r.lamports ? " and devnet SOL for fees" : ""}.`,
    `Transaction: ${explorerTx(r.signature!)}`,
    await wallet(),
  ].join("\n");
}

export async function buyCover(args: CoverArgs & { max_cost: number }): Promise<string> {
  if (!(args.max_cost > 0)) throw new Error("max_cost must be a positive amount of tUSDC.");
  if (args.max_cost > MAX_SPEND) {
    throw new Error(
      `max_cost ${args.max_cost} is above this agent's spending cap of ${MAX_SPEND} ${COLLATERAL_SYMBOL}. Nothing was bought.`,
    );
  }
  const { keypair } = loadWallet();
  const p = await planCover(args);
  const { plan } = p;
  if (plan.legs.length === 0) throw new Error("Those choices cover nothing. Widen starts_below or down_to.");
  const cost = Number(plan.cost) / UNIT;
  if (cost > args.max_cost) {
    throw new Error(`Cover now costs ${money(plan.cost)}, above max_cost ${args.max_cost}. Nothing was bought.`);
  }

  const c = await connection();
  const [balance, lamports] = await Promise.all([tokenBalance(keypair.publicKey), c.getBalance(keypair.publicKey)]);
  if (balance < plan.cost)
    throw new Error(`The wallet has ${money(balance)}; cover costs ${money(plan.cost)}. Call get_test_funds.`);
  if (lamports < MIN_SOL * LAMPORTS_PER_SOL)
    throw new Error("The wallet needs a little devnet SOL for fees. Call get_test_funds.");

  const sig = await send(await coverIxs(keypair.publicKey, plan), keypair);
  return [
    `Bought. Paid ${money(plan.cost)} in one transaction.`,
    `Transaction: ${explorerTx(sig)}`,
    "",
    ...describePlan(p),
  ].join("\n");
}

export async function myCover(): Promise<string> {
  return positionsOf(loadWallet().keypair.publicKey, { claimHint: "Call claim." });
}

export async function claim(): Promise<string> {
  const { keypair } = loadWallet();
  const program = getProgram(await connection());
  const [positions, markets] = await Promise.all([fetchPositions(program, keypair.publicKey), allMarkets(true)]);
  const byAddress = new Map(markets.map((m) => [m.address, m]));
  const ready = positions.flatMap((p) => {
    const m = byAddress.get(p.market);
    return m && m.status !== "open" ? [{ m, owed: positionPayout(m, p.yesAmount, p.noAmount) ?? 0n }] : [];
  });
  if (ready.length === 0) return "Nothing to claim yet. Positions become claimable once their ladder settles.";

  const sigs: string[] = [];
  for (let i = 0; i < ready.length; i += CLAIMS_PER_TX) {
    const batch = ready.slice(i, i + CLAIMS_PER_TX).map((r) => new PublicKey(r.m.address));
    sigs.push(await send(await claimManyIxs(program, { markets: batch, owner: keypair.publicKey }), keypair));
  }
  const total = ready.reduce((a, r) => a + r.owed, 0n);
  return [
    `Claimed ${money(total)} from ${ready.length} settled position${ready.length > 1 ? "s" : ""}.`,
    ...sigs.map((s) => `Transaction: ${explorerTx(s)}`),
    `Balance now: ${money(await tokenBalance(keypair.publicKey))}.`,
  ].join("\n");
}
