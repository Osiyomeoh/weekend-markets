"use client";

import { PublicKey } from "@solana/web3.js";
import { createContext, ReactNode, useContext, useState } from "react";

import { COLLATERAL_SYMBOL } from "@/lib/config";
import { tokens } from "@/lib/format";
import {
  Holding,
  Poll,
  PositionView,
  Quote,
  useHoldings,
  useMarkets,
  useNow,
  usePositions,
  usePrices,
  useTokenBalance,
  useWalletKey,
} from "@/lib/hooks";
import { groupSeries, MarketView, Series } from "@/lib/ladder";
import { Stock, STOCKS } from "@/lib/stocks";

export type Toast = { msg: string; sig?: string; at: number };

type AppState = {
  now: number;
  wallet: PublicKey | null;
  prices: Poll<Record<string, Quote>>;
  markets: Poll<MarketView[]>;
  positions: Poll<PositionView[]>;
  balance: Poll<bigint | null>;
  holdings: Poll<Holding[]>;
  series: Series[];
  marketByAddress: Map<string, MarketView>;
  /** Markets the wallet has a position in. */
  myMarkets: MarketView[];
  /** Stocks that have at least one ladder. */
  listed: Stock[];
  stock: Stock | undefined;
  setSymbol: (symbol: string) => void;
  toast: Toast | null;
  dismissToast: () => void;
  notify: (msg: string, sig?: string) => void;
  refreshAll: () => void;
  faucet: () => Promise<void>;
  fauceting: boolean;
};

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppStateProvider");
  return v;
}

/**
 * Chain and price data shared by every page. It lives above the pages, so
 * moving between them is instant and polling never restarts.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const now = useNow();
  const wallet = useWalletKey();
  const prices = usePrices();
  const markets = useMarkets();
  const positions = usePositions(wallet);
  const balance = useTokenBalance();
  const holdings = useHoldings();
  const [toast, setToast] = useState<Toast | null>(null);
  const [fauceting, setFauceting] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const series = groupSeries(markets.data ?? []);
  const marketByAddress = new Map((markets.data ?? []).map((m) => [m.address, m]));
  const myMarkets = (positions.data ?? []).flatMap((p) => marketByAddress.get(p.market) ?? []);
  const listed = STOCKS.filter((s) => series.some((x) => x.feedId === s.equityFeedId));
  const stock = STOCKS.find((s) => s.symbol === (picked ?? listed[0]?.symbol));

  const notify = (msg: string, sig?: string) => setToast({ msg, sig, at: Math.floor(Date.now() / 1000) });
  const refreshAll = () => {
    markets.refresh();
    positions.refresh();
    balance.refresh();
  };

  async function faucet() {
    if (!wallet) return notify("Connect a wallet first.");
    setFauceting(true);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: wallet.toBase58() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      notify(
        body.alreadyFunded
          ? "You already have test funds."
          : `Sent ${tokens(BigInt(body.tokens), 0)} ${COLLATERAL_SYMBOL}${body.lamports ? " and devnet SOL for fees" : ""}`,
        body.signature ?? undefined,
      );
      balance.refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setFauceting(false);
    }
  }

  return (
    <Ctx.Provider
      value={{
        now,
        wallet,
        prices,
        markets,
        positions,
        balance,
        holdings,
        series,
        marketByAddress,
        myMarkets,
        listed,
        stock,
        setSymbol: setPicked,
        toast,
        dismissToast: () => setToast(null),
        notify,
        refreshAll,
        faucet,
        fauceting,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
