"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { COLLATERAL_SYMBOL, explorerAddress, explorerTx, PROGRAM_ID } from "@/lib/config";
import { tokens, usd } from "@/lib/format";
import { useMarkets, useNow, usePositions, usePrices, useTokenBalance, useWalletKey } from "@/lib/hooks";
import { groupSeries } from "@/lib/ladder";
import { STOCKS } from "@/lib/stocks";

import { PositionsPanel } from "./PositionsPanel";
import { SeriesCard, seriesPhase } from "./SeriesCard";

// The wallet button reads browser-only state, so it renders on the client only.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

type Toast = { msg: string; sig?: string; at: number };

export function App() {
  const now = useNow();
  const wallet = useWalletKey();
  const prices = usePrices();
  const markets = useMarkets();
  const positions = usePositions();
  const balance = useTokenBalance();
  const [toast, setToast] = useState<Toast | null>(null);
  const [fauceting, setFauceting] = useState(false);

  const series = useMemo(() => groupSeries(markets.data ?? []), [markets.data]);
  const listed = STOCKS.filter((s) => series.some((x) => x.feedId === s.equityFeedId));
  const [picked, setPicked] = useState<string | null>(null);
  const symbol = picked ?? listed[0]?.symbol ?? null;
  const stock = STOCKS.find((s) => s.symbol === symbol);
  const stockSeries = series
    .filter((s) => s.feedId === stock?.equityFeedId)
    .sort((a, b) => {
      const live = (x: typeof a) => (seriesPhase(x, now) === "settled" ? 1 : 0);
      return live(a) - live(b) || (live(a) ? b.resolveTs - a.resolveTs : a.resolveTs - b.resolveTs);
    });

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
          ? `You already have test funds.`
          : `Sent ${tokens(BigInt(body.tokens), 0)} ${COLLATERAL_SYMBOL}${body.lamports ? " + devnet SOL for fees" : ""}`,
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
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bell />
          <div>
            <div className="text-lg font-semibold tracking-tight">Weekend Markets</div>
            <div className="text-xs text-muted">Where will it print when the bell rings?</div>
          </div>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">Solana devnet</span>
        </div>
        <div className="flex items-center gap-2">
          {wallet && (
            <>
              <span className="num text-sm text-muted">
                {balance.data === null || balance.data === undefined ? "—" : tokens(balance.data)} {COLLATERAL_SYMBOL}
              </span>
              <button
                onClick={faucet}
                disabled={fauceting}
                className="h-9 rounded-lg border border-line px-3 text-[13px] hover:border-faint disabled:opacity-50"
              >
                {fauceting ? "Sending…" : "Get test funds"}
              </button>
            </>
          )}
          <WalletMultiButton />
        </div>
      </header>

      <section className="rounded-xl border border-line bg-panel px-5 py-5">
        <h1 className="max-w-3xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
          Tokenized stocks trade 24/7. The market that prices them is open 32.5 hours a week.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          Take a side on where a stock prints when trading resumes. Each strike is a YES/NO pool; winners split the pot.
          Settlement is permissionless and fixed in advance: the program only accepts the{" "}
          <span className="text-text">first Pyth price published at or after the deadline</span>, so nobody, including us,
          can pick the number. Across strikes, the pools add up to the crowd&apos;s forecast of the next print.
        </p>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Stocks">
        {STOCKS.map((s) => {
          const q = prices.data?.[s.equityFeedId];
          const has = listed.includes(s);
          return (
            <button
              key={s.symbol}
              onClick={() => setPicked(s.symbol)}
              disabled={!has}
              className={`rounded-lg border px-4 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                s.symbol === symbol ? "border-bell bg-bell-soft" : "border-line bg-panel hover:border-faint"
              }`}
            >
              <div className="text-sm font-medium">{s.symbol}</div>
              <div className="num text-xs text-muted">{q ? usd(q.price) : has ? "…" : "no markets"}</div>
            </button>
          );
        })}
      </nav>

      {markets.error && <p className="text-sm text-no">Could not load markets: {markets.error}</p>}
      {prices.error && <p className="text-sm text-no">Pyth prices unavailable: {prices.error}</p>}
      {markets.data && listed.length === 0 && (
        <p className="rounded-xl border border-line bg-panel px-5 py-6 text-sm text-muted">No markets yet.</p>
      )}

      {stock &&
        stockSeries.map((s) => (
          <SeriesCard
            key={`${s.feedId}:${s.resolveTs}`}
            series={s}
            stock={stock}
            quote={prices.data?.[stock.equityFeedId]}
            now={now}
            onChanged={refreshAll}
            notify={notify}
          />
        ))}

      <PositionsPanel
        positions={positions.data ?? []}
        markets={markets.data ?? []}
        onChanged={refreshAll}
        notify={notify}
      />

      <HowItWorks />

      <footer className="flex flex-wrap justify-between gap-2 border-t border-line pt-4 text-xs text-faint">
        <span>
          Program{" "}
          <a className="num underline hover:text-text" href={explorerAddress(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            {PROGRAM_ID.toBase58()}
          </a>{" "}
          · Prices by Pyth · Devnet test funds only, no real money
        </span>
        <a className="underline hover:text-text" href="https://github.com/Osiyomeoh/weekend-markets" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>

      {toast && now - toast.at < 12 && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <span>{toast.msg}</span>
            <button onClick={() => setToast(null)} className="text-muted hover:text-text" aria-label="Dismiss">
              ×
            </button>
          </div>
          {toast.sig && (
            <a className="mt-1 block text-xs text-bell underline" href={explorerTx(toast.sig)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["Pick a strike", "Each row asks one question: will the stock print at or above this price at the settlement time?"],
    ["Stake YES or NO", "Stakes go into an on-chain vault. The price you see is the pool split; no house, no fee, no AMM."],
    ["Settled by Pyth", "At the deadline, anyone posts the first Pyth price at or after it. The program checks the timing, the feed, the Wormhole signatures and the confidence band."],
    ["Winners split the pot", "Pro rata to stake. If a side is empty or no valid price arrives, everyone is refunded."],
  ];
  return (
    <section className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      {steps.map(([t, d], i) => (
        <div key={t} className="bg-panel px-5 py-4">
          <div className="num text-xs text-bell">0{i + 1}</div>
          <div className="mt-1 text-sm font-medium">{t}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{d}</p>
        </div>
      ))}
    </section>
  );
}

function Bell() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" stroke="var(--bell)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 20.5a2 2 0 0 0 4 0" stroke="var(--bell)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
