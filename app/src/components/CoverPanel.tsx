"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useState } from "react";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT, COLLATERAL_SYMBOL } from "@/lib/config";
import { coverPlan } from "@/lib/cover";
import { countdown, etTime, pct, tokens, usd } from "@/lib/format";
import { Holding, Quote, useSendIxs, useWalletKey } from "@/lib/hooks";
import { impliedProbability, Series } from "@/lib/ladder";
import { getProgram, placeBetIxs } from "@/lib/program";
import { Stock } from "@/lib/stocks";

import { PayoffChart } from "./PayoffChart";
import { seriesPhase } from "./SeriesCard";

const UNIT = 10 ** COLLATERAL_DECIMALS;
const DEFAULT_SHARES = 10;

type Props = {
  stock: Stock;
  series: Series[];
  quote: Quote | undefined;
  holdings: Holding[];
  balance: bigint | null | undefined;
  now: number;
  onChanged: () => void;
  notify: (msg: string, sig?: string) => void;
};

/**
 * Cover for someone holding the stock or a tokenized version of it: a strip
 * of NO stakes on the ladder that pays, in steps, what the position loses if
 * the stock settles lower. See `lib/cover.ts` for the construction.
 */
export function CoverPanel({ stock, series, quote, holdings, balance, now, onChanged, notify }: Props) {
  const { connection } = useConnection();
  const wallet = useWalletKey();
  const sendIxs = useSendIxs();
  const [busy, setBusy] = useState(false);
  const [sharesInput, setSharesInput] = useState<string | null>(null);
  const [pickedTs, setPickedTs] = useState<number | null>(null);
  const [fromInput, setFromInput] = useState<number | null>(null);
  const [toInput, setToInput] = useState<number | null>(null);

  const open = series.filter((s) => seriesPhase(s, now) === "open").sort((a, b) => a.resolveTs - b.resolveTs);
  // Default to the longest horizon: that's the one spanning the weekend.
  const target = open.find((s) => s.resolveTs === pickedTs) ?? open.at(-1);

  const held = holdings.filter((h) => h.stock === stock.symbol);
  const heldShares = held.reduce((a, h) => a + h.shares, 0);
  const shares = Number(sharesInput ?? (heldShares > 0 ? round(heldShares, 4) : DEFAULT_SHARES));
  const spot = quote?.price;

  // Strikes below the price, nearest first. Choices that no longer apply fall back to full cover.
  const below = (target && spot !== undefined ? target.markets.filter((m) => m.status === "open" && m.strike < spot) : [])
    .map((m) => m.strike)
    .sort((a, b) => b - a);
  // By default skip strikes hugging the price: a leg 0.1% below spot costs about as much as it pays.
  const from = below.includes(fromInput!) ? fromInput! : (below.find((k) => spot !== undefined && k <= spot * 0.99) ?? below[0]);
  const to = below.includes(toInput!) && toInput! <= from ? toInput! : below.at(-1);
  const plan = target && spot !== undefined ? coverPlan(target.markets, spot, shares, UNIT, { from, to }) : null;

  if (open.length === 0 || !target) return null;

  const value = spot !== undefined && shares > 0 ? shares * spot : null;
  const cost = plan ? Number(plan.cost) / UNIT : 0;
  const short = balance !== null && balance !== undefined && plan ? balance < plan.cost : false;

  async function buy() {
    if (!wallet) return notify("Connect a wallet to buy cover.");
    if (!plan || plan.legs.length === 0) return;
    setBusy(true);
    try {
      const program = getProgram(connection);
      const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, wallet);
      const legs = await Promise.all(
        plan.legs.map((l) =>
          placeBetIxs(program, { market: new PublicKey(l.market.address), bettor: wallet, side: "no", amount: l.stake }),
        ),
      );
      const sig = await sendIxs([
        createAssociatedTokenAccountIdempotentInstruction(wallet, ata, wallet, COLLATERAL_MINT),
        ...legs.flat(),
      ]);
      notify(
        `Covered ${round(shares, 4)} ${stock.symbol} below ${usd(plan.legs[0].strike)} for ${tokens(plan.cost)} ${COLLATERAL_SYMBOL}`,
        sig,
      );
      onChanged();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-bell/40 bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-bell">Gap cover</div>
          <h2 className="mt-0.5 text-lg font-medium">
            Protect a {stock.symbol} position until {etTime(target.resolveTs, false)}
          </h2>
        </div>
        <span className="num rounded-full bg-yes-soft px-3 py-1 text-xs font-medium text-yes">
          Cover on sale for {countdown(target.lockTs - now)}
        </span>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-px bg-line lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-4 bg-panel px-5 py-4">
          {open.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Cover until">
              {open.map((s) => (
                <button
                  key={s.resolveTs}
                  onClick={() => setPickedTs(s.resolveTs)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    s === target ? "border-bell bg-bell-soft text-text" : "border-line text-muted hover:border-faint"
                  }`}
                >
                  Until {etTime(s.resolveTs, false)}
                </button>
              ))}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">
              Shares you hold ({[stock.symbol, ...stock.tokenized.map((t) => t.symbol)].join(", ")})
            </span>
            <input
              value={sharesInput ?? String(shares)}
              onChange={(e) => setSharesInput(e.target.value)}
              inputMode="decimal"
              className="num rounded-md border border-line bg-bg px-3 py-2 text-base outline-none focus:border-faint"
            />
            <HoldingsNote
              stock={stock}
              held={held}
              wallet={!!wallet}
              onUse={() => setSharesInput(String(round(heldShares, 4)))}
            />
          </label>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted">Pyth {stock.symbol} now</div>
              <div className="num mt-0.5">{spot !== undefined ? usd(spot) : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Position value</div>
              <div className="num mt-0.5">{value !== null ? usd(value) : "—"}</div>
            </div>
          </div>

          {below.length > 1 && spot !== undefined && (
            <div className="grid grid-cols-2 gap-3">
              <StrikeSelect label="Cover starts below" value={from} options={below} spot={spot} onChange={setFromInput} />
              <StrikeSelect
                label="Cover down to"
                value={to!}
                options={below.filter((k) => k <= from)}
                spot={spot}
                onChange={setToInput}
              />
            </div>
          )}

          <p className="text-xs leading-relaxed text-faint">
            Cover is a NO stake on each strike in that range, sized so that if {stock.symbol} settles below a strike you
            are paid what your shares lost down to it. It is built from the same pools anyone can trade below.
          </p>
        </div>

        <div className="flex flex-col bg-panel">
          {spot === undefined ? (
            <p className="px-5 py-6 text-sm text-muted">Waiting for the Pyth {stock.symbol} price…</p>
          ) : !(shares > 0) ? (
            <p className="px-5 py-6 text-sm text-muted">Enter how many shares you want to cover.</p>
          ) : !plan || plan.legs.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">
              No open strikes below {usd(spot)} in this ladder, so there is nothing to cover against.
            </p>
          ) : (
            <>
              <div className="px-3 pt-3">
                <PayoffChart plan={plan} spot={spot} shares={shares} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-line text-left text-xs uppercase tracking-wider text-muted">
                      <th className="px-3 py-2 font-normal sm:px-5">If {stock.symbol} settles below</th>
                      <th className="px-3 py-2 text-right font-normal">You are down at least</th>
                      <th className="px-3 py-2 text-right font-normal sm:px-5">Cover pays</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.legs.map((l, i) => {
                      const paid = plan.legs.slice(0, i + 1).reduce((a, x) => a + x.payout, 0n);
                      const p = impliedProbability(l.market);
                      return (
                        <tr key={l.market.address} className="border-b border-line/60">
                          <td className="num px-3 py-2.5 sm:px-5">
                            {usd(l.strike)} <span className="text-faint">({pct(l.strike / spot - 1, 1)})</span>
                          </td>
                          <td className="num px-3 py-2.5 text-right text-no">{usd(shares * (spot - l.strike))}</td>
                          <td className="num px-3 py-2.5 text-right sm:px-5">
                            {tokens(paid)}{" "}
                            <span className="block text-xs text-faint sm:inline" title="Crowd probability of settling below this strike">
                              {p === null ? "" : `· ${Math.round((1 - p) * 100)}% odds`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-5 pt-2 text-xs text-faint">
                At or above {usd(plan.legs[0].strike)} cover pays nothing: the first {pct(plan.legs[0].strike / spot - 1, 1).slice(1)} of any
                drop is yours. Between strikes it trails your loss by less than one step, and it never pays more than you lose.
              </p>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                <div>
                  <div className="text-xs text-muted">Cost now</div>
                  <div className="num text-xl">
                    {tokens(plan.cost)} <span className="text-sm text-muted">{COLLATERAL_SYMBOL}</span>
                  </div>
                  <div className="num text-xs text-faint">
                    {value ? `${((cost / value) * 100).toFixed(2)}% of position` : ""} · pays up to {tokens(plan.maxPayout, 0)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={buy}
                    disabled={busy || short}
                    className="rounded-md bg-bell px-5 py-2.5 text-sm font-medium text-bg transition hover:brightness-110 disabled:opacity-50"
                  >
                    {busy ? "Buying cover…" : wallet ? `Buy cover · ${plan.legs.length} NO stakes` : "Connect a wallet to buy"}
                  </button>
                  {short && <span className="text-xs text-no">Not enough {COLLATERAL_SYMBOL}: use Get test funds above.</span>}
                </div>
              </div>
              <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-faint">
                Estimated at current pools. Pools keep moving until betting closes at {etTime(target.lockTs, false)}: if
                more money joins the NO side, each leg pays a little less, and you can top up. Settles on the first Pyth{" "}
                {stock.symbol} print at or after {etTime(target.resolveTs)}.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function StrikeSelect({
  label,
  value,
  options,
  spot,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  spot: number;
  onChange: (strike: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num rounded-md border border-line bg-bg px-2 py-2 text-sm outline-none focus:border-faint"
      >
        {options.map((k) => (
          <option key={k} value={k}>
            {usd(k)} ({pct(k / spot - 1, 1)})
          </option>
        ))}
      </select>
    </label>
  );
}

function HoldingsNote({ stock, held, wallet, onUse }: { stock: Stock; held: Holding[]; wallet: boolean; onUse: () => void }) {
  const names = stock.tokenized.map((t) => t.symbol).join(" or ");
  if (!wallet) return <span className="text-xs text-faint">Connect a wallet to fill this in from your {names} on mainnet.</span>;
  if (held.length === 0)
    return <span className="text-xs text-faint">No {names} in this wallet on mainnet. Enter any size to try it.</span>;
  return (
    <span className="text-xs text-muted">
      Found on mainnet (read-only):{" "}
      {held.map((h) => `${round(h.shares, 4)} ${h.symbol}`).join(" + ")}.{" "}
      <button type="button" onClick={onUse} className="text-bell underline">
        Use this
      </button>
    </span>
  );
}

function round(x: number, digits: number): number {
  return Math.round(x * 10 ** digits) / 10 ** digits;
}
