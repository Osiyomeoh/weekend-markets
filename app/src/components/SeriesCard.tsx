"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useMemo, useState } from "react";

import { COLLATERAL_MINT, COLLATERAL_SYMBOL, explorerAddress } from "@/lib/config";
import { countdown, etTime, pct, toRaw, tokens, usd } from "@/lib/format";
import { Quote, useSendIxs, useWalletKey } from "@/lib/hooks";
import {
  impliedMedian,
  impliedProbability,
  MarketView,
  previewPayout,
  Series,
  seriesCurve,
  Side,
} from "@/lib/ladder";
import { getProgram, placeBetIxs } from "@/lib/program";
import { Stock } from "@/lib/stocks";

import { CurveChart } from "./CurveChart";

type Props = {
  series: Series;
  stock: Stock;
  quote: Quote | undefined;
  now: number;
  onChanged: () => void;
  notify: (msg: string, sig?: string) => void;
};

export function seriesPhase(s: Series, now: number): "open" | "locked" | "due" | "settled" {
  if (s.markets.every((m) => m.status !== "open")) return "settled";
  if (now >= s.resolveTs) return "due";
  if (now >= s.lockTs) return "locked";
  return "open";
}

export function SeriesCard({ series, stock, quote, now, onChanged, notify }: Props) {
  const { connection } = useConnection();
  const wallet = useWalletKey();
  const sendIxs = useSendIxs();
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);

  const phase = seriesPhase(series, now);
  const curve = useMemo(() => seriesCurve(series), [series]);
  const raw = series.markets.flatMap((m) => {
    const p = impliedProbability(m);
    return p === null ? [] : [{ strike: m.strike, p }];
  });
  const median = impliedMedian(curve);
  const pot = series.markets.reduce((a, m) => a + m.yesPool + m.noPool, 0n);
  const settled = series.markets.find((m) => m.settlePrice !== null);
  const spot = quote?.price;
  const quoteAge = quote ? now - quote.publishTime : null;
  const raw_amount = toRaw(amount);

  const markers = [
    ...(spot !== undefined && phase !== "settled" ? [{ x: spot, label: "Pyth now", color: "var(--text)" }] : []),
    ...(median !== null && phase !== "settled" ? [{ x: median, label: "Crowd 50%", color: "var(--bell)" }] : []),
    ...(settled?.settlePrice != null ? [{ x: settled.settlePrice, label: "Settled", color: "var(--bell)" }] : []),
  ];

  async function bet(m: MarketView, side: Side) {
    if (!wallet) return notify("Connect a wallet to trade.");
    if (!raw_amount) return notify("Enter an amount.");
    setBusy(`${m.address}:${side}`);
    try {
      const program = getProgram(connection);
      const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, wallet);
      const sig = await sendIxs([
        createAssociatedTokenAccountIdempotentInstruction(wallet, ata, wallet, COLLATERAL_MINT),
        ...(await placeBetIxs(program, { market: new PublicKey(m.address), bettor: wallet, side, amount: raw_amount })),
      ]);
      notify(`${side.toUpperCase()} ${tokens(raw_amount)} ${COLLATERAL_SYMBOL} on ${stock.symbol} ≥ ${usd(m.strike)}`, sig);
      onChanged();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function settle() {
    setBusy("settle");
    try {
      let last: string | undefined;
      for (const m of series.markets.filter((m) => m.status === "open")) {
        const res = await fetch("/api/settle", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ market: m.address }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        last = body.signatures.at(-1);
      }
      notify(`${stock.symbol} ladder settled from Pyth`, last);
      onChanged();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">Settles on the first Pyth print at or after</div>
          <div className="mt-0.5 text-lg font-medium">{etTime(series.resolveTs)}</div>
        </div>
        <PhaseChip phase={phase} lockIn={series.lockTs - now} settleIn={series.resolveTs - now} />
      </header>

      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        <Stat label={`Pyth ${stock.symbol} now`} value={spot !== undefined ? usd(spot) : "—"}
          hint={quoteAge === null ? "feed unavailable" : quoteAge > 120 ? "market closed · last print" : `${quoteAge}s ago`} />
        <Stat label="Crowd 50% level" value={median !== null ? usd(median) : "—"}
          hint={median !== null && spot !== undefined ? `${pct(median / spot - 1, 2)} vs now` : "not bracketed"} accent />
        <Stat label="Total staked" value={`${tokens(pot, 0)}`} hint={COLLATERAL_SYMBOL} />
        <Stat
          label={settled ? "Settled at" : "Betting"}
          value={settled?.settlePrice != null ? usd(settled.settlePrice, 4) : phase === "open" ? "Open" : "Closed"}
          hint={settled?.settlePublishTime ? `published ${etTime(settled.settlePublishTime)}` : `locks ${etTime(series.lockTs, false)}`}
        />
      </div>

      <div className="px-3 pt-3">
        <CurveChart curve={curve} raw={raw} markers={markers} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-y border-line text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-5 py-2 font-normal">{stock.symbol} at or above</th>
              <th className="px-3 py-2 font-normal">vs now</th>
              <th className="px-3 py-2 font-normal">Crowd says YES</th>
              <th className="px-3 py-2 text-right font-normal">Pool</th>
              <th className="px-5 py-2 text-right font-normal">
                {phase === "open" ? (
                  <span className="inline-flex items-center gap-2 normal-case tracking-normal">
                    Stake
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      aria-label={`Stake in ${COLLATERAL_SYMBOL}`}
                      className="num w-20 rounded-md border border-line bg-bg px-2 py-1 text-right text-text outline-none focus:border-faint"
                    />
                    {COLLATERAL_SYMBOL}
                  </span>
                ) : (
                  "Result"
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...series.markets].reverse().map((m) => {
              const p = impliedProbability(m);
              return (
                <tr key={m.address} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-3">
                    <a href={explorerAddress(m.address)} target="_blank" rel="noreferrer" className="num font-medium hover:text-bell">
                      {usd(m.strike)}
                    </a>
                  </td>
                  <td className="num px-3 py-3 text-muted">{spot !== undefined ? pct(m.strike / spot - 1, 2) : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-no-soft">
                        <div className="h-full bg-yes" style={{ width: `${(p ?? 0) * 100}%` }} />
                      </div>
                      <span className="num w-10 text-right">{p === null ? "—" : `${Math.round(p * 100)}%`}</span>
                    </div>
                  </td>
                  <td className="num px-3 py-3 text-right text-muted">{tokens(m.yesPool + m.noPool, 0)}</td>
                  <td className="px-5 py-3 text-right">
                    {phase === "open" ? (
                      <div className="inline-flex gap-2">
                        {(["yes", "no"] as const).map((side) => (
                          <button
                            key={side}
                            disabled={!!busy}
                            onClick={() => bet(m, side)}
                            className={`num rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                              side === "yes" ? "bg-yes-soft text-yes hover:bg-yes/25" : "bg-no-soft text-no hover:bg-no/25"
                            }`}
                            title={raw_amount ? `Pays ${tokens(previewPayout(m, side, raw_amount))} if ${side.toUpperCase()} wins, at current pools` : undefined}
                          >
                            {busy === `${m.address}:${side}` ? "…" : side.toUpperCase()}
                            {raw_amount ? ` → ${tokens(previewPayout(m, side, raw_amount), 1)}` : ""}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Outcome m={m} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {phase === "due" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bell-soft px-5 py-3 text-sm">
          <span>
            Settlement time has passed. Anyone can settle: the program only accepts the first Pyth print at or after{" "}
            {etTime(series.resolveTs)}.
          </span>
          <button
            onClick={settle}
            disabled={!!busy}
            className="rounded-md bg-bell px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
          >
            {busy === "settle" ? "Posting Pyth price…" : "Settle from Pyth"}
          </button>
        </div>
      )}
      {settled && <Receipt m={settled} />}
    </section>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-5 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-0.5 text-lg ${accent ? "text-bell" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

function PhaseChip({ phase, lockIn, settleIn }: { phase: string; lockIn: number; settleIn: number }) {
  const map: Record<string, [string, string]> = {
    open: [`Betting closes in ${countdown(lockIn)}`, "bg-yes-soft text-yes"],
    locked: [`Locked · settles in ${countdown(settleIn)}`, "bg-bell-soft text-bell"],
    due: ["Ready to settle", "bg-bell-soft text-bell"],
    settled: ["Settled", "bg-panel-2 text-muted"],
  };
  const [text, cls] = map[phase];
  return <span className={`num rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{text}</span>;
}

function Outcome({ m }: { m: MarketView }) {
  if (m.status === "voided")
    return <span className="text-xs text-muted">Voided · refunded ({m.voidReason === "oneSidedPool" ? "one-sided" : "no price"})</span>;
  if (m.status === "open") return <span className="text-xs text-muted">Awaiting settlement</span>;
  return m.outcome === "yes" ? (
    <span className="rounded-md bg-yes-soft px-2 py-1 text-xs font-medium text-yes">YES won</span>
  ) : (
    <span className="rounded-md bg-no-soft px-2 py-1 text-xs font-medium text-no">NO won</span>
  );
}

function Receipt({ m }: { m: MarketView }) {
  return (
    <div className="border-t border-line px-5 py-3 text-xs text-muted">
      Settlement receipt: Pyth price <span className="num text-text">{usd(m.settlePrice!, 4)}</span> ± {usd(m.settleConf!, 4)},
      published <span className="num text-text">{etTime(m.settlePublishTime!)}</span>, verified on-chain as the first print at or after{" "}
      {etTime(m.resolveTs)} (its predecessor was published earlier).{" "}
      <a className="underline hover:text-text" href={explorerAddress(m.address)} target="_blank" rel="noreferrer">
        View market account
      </a>
    </div>
  );
}

