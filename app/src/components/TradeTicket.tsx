"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useState } from "react";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT, COLLATERAL_SYMBOL } from "@/lib/config";
import { etTime, toRaw, tokens, usd } from "@/lib/format";
import { useSendIxs, useWalletKey } from "@/lib/hooks";
import { impliedProbability, MarketView, previewPayout, Side } from "@/lib/ladder";
import { getProgram, placeBetIxs } from "@/lib/program";
import { Stock } from "@/lib/stocks";

const CHIPS = [10, 50, 100];

/** Pool share as a price per 1.00 of payout, the way prediction markets quote it. */
export function cents(p: number | null): string {
  if (p === null) return "";
  if (p > 0 && p < 0.01) return "<1¢";
  if (p < 1 && p > 0.99) return ">99¢";
  return `${Math.round(p * 100)}¢`;
}

export function sidePrice(m: MarketView, side: Side): number | null {
  const p = impliedProbability(m);
  return p === null ? null : side === "yes" ? p : 1 - p;
}

type Props = {
  market: MarketView;
  side: Side;
  stock: Stock;
  balance: bigint | null | undefined;
  onSide: (side: Side) => void;
  onClose: () => void;
  onChanged: () => void;
  notify: (msg: string, sig?: string) => void;
};

/** Order ticket for one strike: pick a side and an amount, see the payout, confirm. */
export function TradeTicket({ market, side, stock, balance, onSide, onClose, onChanged, notify }: Props) {
  const { connection } = useConnection();
  const wallet = useWalletKey();
  const sendIxs = useSendIxs();
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);

  const raw = toRaw(amount);
  const payout = raw ? previewPayout(market, side, raw) : 0n;
  const avg = raw && payout > 0n ? Number(raw) / Number(payout) : null;
  const short = raw !== null && balance !== null && balance !== undefined && raw > balance;
  const add = (x: number) => setAmount(String(Math.round(((raw ? Number(raw) / 10 ** COLLATERAL_DECIMALS : 0) + x) * 1e6) / 1e6));

  async function submit() {
    if (!wallet) return notify("Connect a wallet to trade.");
    if (!raw) return notify("Enter an amount.");
    setBusy(true);
    try {
      const program = getProgram(connection);
      const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, wallet);
      const sig = await sendIxs([
        createAssociatedTokenAccountIdempotentInstruction(wallet, ata, wallet, COLLATERAL_MINT),
        ...(await placeBetIxs(program, { market: new PublicKey(market.address), bettor: wallet, side, amount: raw })),
      ]);
      notify(`Bought ${side.toUpperCase()} on ${stock.symbol} ≥ ${usd(market.strike)} for ${tokens(raw)} ${COLLATERAL_SYMBOL}`, sig);
      onChanged();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel-2 p-4 shadow-2xl lg:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">
            {stock.symbol} at or above <span className="num">{usd(market.strike)}</span>
          </div>
          <div className="text-xs text-faint">first Pyth print at or after {etTime(market.resolveTs, false)}</div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-text" aria-label="Close ticket">
          ×
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Side">
        {(["yes", "no"] as const).map((s) => (
          <button
            key={s}
            onClick={() => onSide(s)}
            aria-pressed={s === side}
            className={`num rounded-lg py-2.5 text-sm font-medium transition ${
              s === side
                ? s === "yes"
                  ? "bg-yes text-bg"
                  : "bg-no text-bg"
                : "border border-line text-muted hover:border-faint"
            }`}
          >
            {s === "yes" ? "Yes" : "No"} {cents(sidePrice(market, s))}
          </button>
        ))}
      </div>

      <label className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted">Amount</span>
        <span className="flex items-baseline gap-1">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            aria-label={`Amount in ${COLLATERAL_SYMBOL}`}
            className="num w-32 bg-transparent text-right text-2xl outline-none"
          />
          <span className="text-xs text-muted">{COLLATERAL_SYMBOL}</span>
        </span>
      </label>
      <div className="mt-2 flex justify-end gap-1.5">
        {CHIPS.map((c) => (
          <button key={c} onClick={() => add(c)} className="num rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-faint">
            +{c}
          </button>
        ))}
        {balance ? (
          <button
            onClick={() => setAmount(String(Number(balance) / 10 ** COLLATERAL_DECIMALS))}
            className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-faint"
          >
            Max
          </button>
        ) : null}
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Avg price</dt>
          <dd className="num">{avg === null ? "—" : `${(avg * 100).toFixed(1)}¢`}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">To win</dt>
          <dd className="num text-lg text-yes">
            {raw ? tokens(payout) : "—"} <span className="text-xs text-muted">{COLLATERAL_SYMBOL}</span>
          </dd>
        </div>
      </dl>

      <button
        onClick={submit}
        disabled={busy || !raw || short}
        className={`mt-3 w-full rounded-lg py-3 text-sm font-medium text-bg transition hover:brightness-110 disabled:opacity-50 ${
          side === "yes" ? "bg-yes" : "bg-no"
        }`}
      >
        {busy ? "Confirm in your wallet…" : !wallet ? "Connect a wallet to trade" : `Buy ${side === "yes" ? "Yes" : "No"}`}
      </button>
      {short && <p className="mt-2 text-xs text-no">More than your balance. Use Get test funds at the top.</p>}
      <p className="mt-3 text-xs leading-relaxed text-faint">
        Winners split the whole pool, so the payout is an estimate at current pools and moves as others trade until
        betting closes at {etTime(market.lockTs, false)}.
      </p>
    </div>
  );
}
