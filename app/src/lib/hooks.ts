"use client";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { COLLATERAL_MINT, OPERATOR } from "./config";
import { MarketView } from "./ladder";
import { fetchMarkets, fetchPositions, getProgram, PositionView } from "./program";

export type Quote = { feedId: string; price: number; conf: number; publishTime: number };
export type Holding = { stock: string; symbol: string; issuer: string; mint: string; shares: number };

/** A polled value: `data` is null until the first load. */
export type Poll<T> = { data: T | null; error: string | null; refresh: () => Promise<void> };

/** Re-runs `fn` every `ms`, and immediately whenever `deps` change. */
function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[]): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const refresh = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, ms, ...deps]);
  return { data, error, refresh };
}

export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function usePrices() {
  return usePoll(
    async () => {
      const res = await fetch("/api/prices", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "price feed unavailable");
      return body.quotes as Record<string, Quote>;
    },
    5_000,
    [],
  );
}

export type TokenPrice = { mint: string; price: number; liquidity: number; source: "jupiter" };

/** 24/7 prices of tokenized stocks on Solana, keyed by mint. Display only. */
export function useTokenPrices() {
  return usePoll(
    async () => {
      const res = await fetch("/api/token-prices", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "token prices unavailable");
      return body.prices as Record<string, TokenPrice>;
    },
    15_000,
    [],
  );
}

export function useMarkets() {
  const { connection } = useConnection();
  const program = useMemo(() => getProgram(connection), [connection]);
  return usePoll(() => fetchMarkets(program, OPERATOR), 8_000, [program]);
}

/** Positions held by `owner` (the connected wallet, or any address for a read-only view). */
export function usePositions(owner: PublicKey | null) {
  const { connection } = useConnection();
  const program = useMemo(() => getProgram(connection), [connection]);
  return usePoll(
    async (): Promise<PositionView[]> => (owner ? fetchPositions(program, owner) : []),
    8_000,
    [program, owner?.toBase58()],
  );
}

export function useTokenBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return usePoll(
    async (): Promise<bigint | null> => {
      if (!publicKey) return null;
      const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, publicKey);
      try {
        return BigInt((await connection.getTokenAccountBalance(ata)).value.amount);
      } catch {
        return 0n;
      }
    },
    8_000,
    [connection, publicKey?.toBase58()],
  );
}

/** Tokenized stocks the connected wallet holds on mainnet (read-only lookup). */
export function useHoldings() {
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58();
  return usePoll(
    async (): Promise<Holding[]> => {
      if (!owner) return [];
      const res = await fetch(`/api/holdings?owner=${owner}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "holdings lookup failed");
      return body.holdings as Holding[];
    },
    120_000,
    [owner],
  );
}

/**
 * Signs with the connected wallet, sends, and waits for confirmation. We only
 * ask the wallet to sign and broadcast ourselves, so the transaction reaches
 * devnet even when the wallet itself is pointed at mainnet.
 */
export function useSendIxs() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  return useCallback(
    async (ixs: TransactionInstruction[]): Promise<string> => {
      if (!publicKey) throw new Error("Connect a wallet first");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
      let signature: string;
      try {
        signature = signTransaction
          ? await connection.sendRawTransaction((await signTransaction(tx)).serialize(), { preflightCommitment: "confirmed" })
          : await sendTransaction(tx, connection);
      } catch (e) {
        throw new Error(walletHint(e as Error));
      }
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
      return signature;
    },
    [connection, publicKey, sendTransaction, signTransaction],
  );
}

/**
 * Wallets preview a transaction on whatever network they are set to. Ours only
 * exist on devnet, so a wallet on mainnet shows a failed simulation and the
 * user cancels; say what to change.
 */
function walletHint(e: Error): string {
  return /reject|denied|cancel|declin/i.test(e.message)
    ? "Cancelled in your wallet. If it showed Solana Mainnet or a failed simulation, switch the wallet to Devnet and try again."
    : e.message;
}

export function useWalletKey(): PublicKey | null {
  return useWallet().publicKey;
}

export type { MarketView, PositionView };
