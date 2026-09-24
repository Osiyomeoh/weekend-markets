import { AnchorProvider, BN, Program } from "@anchor-lang/core";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

import { COLLATERAL_MINT, PROGRAM_ID } from "./config";
import idl from "./idl/weekend_markets.json";
import type { WeekendMarkets } from "./idl/weekend_markets";
import { MarketView, Side } from "./ladder";
import { bytesToFeedId, feedIdToBytes } from "./stocks";

type WalletLike = AnchorProvider["wallet"];

/** A wallet that can't sign: enough for reads and for building instructions. */
function readOnlyWallet(publicKey = PublicKey.default): WalletLike {
  return {
    publicKey,
    signTransaction: () => Promise.reject(new Error("read-only wallet")),
    signAllTransactions: () => Promise.reject(new Error("read-only wallet")),
  } as WalletLike;
}

export function getProgram(connection: Connection, wallet?: WalletLike): Program<WeekendMarkets> {
  const provider = new AnchorProvider(connection, wallet ?? readOnlyWallet(), {
    commitment: "confirmed",
  });
  return new Program<WeekendMarkets>(idl as WeekendMarkets, provider);
}

// ---------------------------------------------------------------- PDAs

export function marketPda(creator: PublicKey, marketId: bigint): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(marketId);
  return PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), id], PROGRAM_ID)[0];
}

export function vaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], PROGRAM_ID)[0];
}

export function positionPda(market: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer()],
    PROGRAM_ID,
  )[0];
}

// ---------------------------------------------------------------- decoding

type RawMarket = Awaited<ReturnType<Program<WeekendMarkets>["account"]["market"]["fetch"]>>;

function enumKey<T extends object>(value: T): string {
  return Object.keys(value)[0];
}

export function toMarketView(address: PublicKey, m: RawMarket): MarketView {
  const status = enumKey(m.status) as MarketView["status"];
  const settled = status === "resolved";
  return {
    address: address.toBase58(),
    creator: m.creator.toBase58(),
    marketId: m.marketId.toString(),
    feedId: bytesToFeedId(m.feedId),
    strike: m.strikePrice.toNumber() * 10 ** m.strikeExpo,
    lockTs: m.lockTs.toNumber(),
    resolveTs: m.resolveTs.toNumber(),
    resolveWindowSecs: m.resolveWindowSecs,
    voidDelaySecs: m.voidDelaySecs,
    maxConfBps: m.maxConfBps,
    yesPool: BigInt(m.yesPool.toString()),
    noPool: BigInt(m.noPool.toString()),
    openPositions: m.openPositions,
    status,
    outcome: m.outcome ? (enumKey(m.outcome) as Side) : null,
    voidReason: m.voidReason ? (enumKey(m.voidReason) as MarketView["voidReason"]) : null,
    settlePrice: settled ? m.settlePrice.toNumber() * 10 ** m.settleExpo : null,
    settleConf: settled ? m.settleConf.toNumber() * 10 ** m.settleExpo : null,
    settlePublishTime: settled ? m.settlePublishTime.toNumber() : null,
  };
}

/** All markets created by `creator` (the creator pubkey is the first field). */
export async function fetchMarkets(program: Program<WeekendMarkets>, creator: PublicKey): Promise<MarketView[]> {
  const rows = await program.account.market.all([{ memcmp: { offset: 8, bytes: creator.toBase58() } }]);
  return rows.map((r) => toMarketView(r.publicKey, r.account));
}

export async function fetchMarket(program: Program<WeekendMarkets>, market: PublicKey): Promise<MarketView> {
  return toMarketView(market, await program.account.market.fetch(market));
}

export type PositionView = { address: string; market: string; yesAmount: bigint; noAmount: bigint };

export async function fetchPositions(program: Program<WeekendMarkets>, owner: PublicKey): Promise<PositionView[]> {
  const rows = await program.account.position.all([{ memcmp: { offset: 8, bytes: owner.toBase58() } }]);
  return rows.map((r) => ({
    address: r.publicKey.toBase58(),
    market: r.account.market.toBase58(),
    yesAmount: BigInt(r.account.yesAmount.toString()),
    noAmount: BigInt(r.account.noAmount.toString()),
  }));
}

// ---------------------------------------------------------------- instructions

const sideArg = (side: Side) => (side === "yes" ? { yes: {} } : { no: {} });

export async function placeBetIxs(
  program: Program<WeekendMarkets>,
  args: { market: PublicKey; bettor: PublicKey; side: Side; amount: bigint },
): Promise<TransactionInstruction[]> {
  const bettorToken = getAssociatedTokenAddressSync(COLLATERAL_MINT, args.bettor);
  const bet = await program.methods
    .placeBet(sideArg(args.side), new BN(args.amount.toString()))
    .accountsPartial({
      bettor: args.bettor,
      market: args.market,
      position: positionPda(args.market, args.bettor),
      collateralMint: COLLATERAL_MINT,
      bettorToken,
      vault: vaultPda(args.market),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return [bet];
}

export async function claimIxs(
  program: Program<WeekendMarkets>,
  args: { market: PublicKey; owner: PublicKey },
): Promise<TransactionInstruction[]> {
  const ownerToken = getAssociatedTokenAddressSync(COLLATERAL_MINT, args.owner);
  const claim = await program.methods
    .claim()
    .accountsPartial({
      owner: args.owner,
      market: args.market,
      position: positionPda(args.market, args.owner),
      collateralMint: COLLATERAL_MINT,
      ownerToken,
      vault: vaultPda(args.market),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  // The token account may have been closed since betting; recreate if needed.
  return [
    createAssociatedTokenAccountIdempotentInstruction(args.owner, ownerToken, args.owner, COLLATERAL_MINT),
    claim,
  ];
}

/** Claims several settled positions: one token-account check, then a claim per market. */
export async function claimManyIxs(
  program: Program<WeekendMarkets>,
  args: { markets: PublicKey[]; owner: PublicKey },
): Promise<TransactionInstruction[]> {
  if (args.markets.length === 0) return [];
  const each = await Promise.all(args.markets.map((market) => claimIxs(program, { market, owner: args.owner })));
  return [each[0][0], ...each.map((ixs) => ixs[1])];
}

export type CreateMarketArgs = {
  creator: PublicKey;
  marketId: bigint;
  feedId: string;
  strikePrice: number;
  strikeExpo: number;
  lockTs: number;
  resolveTs: number;
  resolveWindowSecs: number;
  voidDelaySecs: number;
  maxConfBps: number;
};

export async function createMarketIx(
  program: Program<WeekendMarkets>,
  a: CreateMarketArgs,
): Promise<{ market: PublicKey; ix: TransactionInstruction }> {
  const market = marketPda(a.creator, a.marketId);
  const ix = await program.methods
    .createMarket({
      marketId: new BN(a.marketId.toString()),
      feedId: feedIdToBytes(a.feedId),
      strikePrice: new BN(a.strikePrice),
      strikeExpo: a.strikeExpo,
      lockTs: new BN(a.lockTs),
      resolveTs: new BN(a.resolveTs),
      resolveWindowSecs: a.resolveWindowSecs,
      voidDelaySecs: a.voidDelaySecs,
      maxConfBps: a.maxConfBps,
    })
    .accountsPartial({
      creator: a.creator,
      market,
      collateralMint: COLLATERAL_MINT,
      vault: vaultPda(market),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return { market, ix };
}

export async function resolveIx(
  program: Program<WeekendMarkets>,
  market: PublicKey,
  priceUpdate: PublicKey,
): Promise<TransactionInstruction> {
  return program.methods.resolve().accountsPartial({ market, priceUpdate }).instruction();
}

export async function voidIx(program: Program<WeekendMarkets>, market: PublicKey): Promise<TransactionInstruction> {
  return program.methods.voidMarket().accountsPartial({ market }).instruction();
}
