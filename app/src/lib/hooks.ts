"use client";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { COLLATERAL_MINT, OPERATOR } from "./config";
import { MarketView } from "./ladder";
import { fetchMarkets, fetchPositions, getProgram, PositionView } from "./program";

export type Quote = { feedId: string; price: number; conf: number; publishTime: number };

/** Re-runs `fn` every `ms`, and immediately whenever `deps` change. */
function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[]) {
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

export function useMarkets() {
  const { connection } = useConnection();
  const program = useMemo(() => getProgram(connection), [connection]);
  return usePoll(() => fetchMarkets(program, OPERATOR), 8_000, [program]);
}

export function usePositions() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useMemo(() => getProgram(connection), [connection]);
  return usePoll(
    async (): Promise<PositionView[]> => (publicKey ? fetchPositions(program, publicKey) : []),
    8_000,
    [program, publicKey?.toBase58()],
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

/** Signs with the connected wallet, sends, and waits for confirmation. */
export function useSendIxs() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  return useCallback(
    async (ixs: TransactionInstruction[]): Promise<string> => {
      if (!publicKey) throw new Error("Connect a wallet first");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
      const signature = await sendTransaction(tx, connection);
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
      return signature;
    },
    [connection, publicKey, sendTransaction],
  );
}

export function useWalletKey(): PublicKey | null {
  return useWallet().publicKey;
}

export type { MarketView, PositionView };
