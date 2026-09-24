"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { settleMarkets } from "@/lib/client/settle";
import { COLLATERAL_SYMBOL, explorerAddress } from "@/lib/config";
import { countdown, etTime, shortAddress, tokens, usd } from "@/lib/format";
import { PositionView, usePositions, useSendIxs } from "@/lib/hooks";
import { currentPayout, groupSeries, MarketView, positionPayout } from "@/lib/ladder";
import { claimManyIxs, getProgram } from "@/lib/program";
import { stockByEquityFeed } from "@/lib/stocks";

import { useApp } from "../AppState";
import { PageHeader } from "../Shell";
import { Skeleton } from "../Skeleton";

type Row = { p: PositionView; m: MarketView };

// Claims per transaction; each adds three accounts, well inside the size limit.
const CLAIMS_PER_TX = 6;

function parseAddress(value: string | null): PublicKey | null {
  try {
    return value ? new PublicKey(value) : null;
  } catch {
    return null;
  }
}

export function PortfolioView() {
  const app = useApp();
  const { wallet, marketByAddress, balance, now, notify } = app;
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const sendIxs = useSendIxs();
  const [busy, setBusy] = useState<string | null>(null);

  // ?address=<wallet> shows any wallet's positions, read-only (they're public on-chain).
  const viewAs = parseAddress(useSearchParams().get("address"));
  const viewed = usePositions(viewAs);
  const readOnly = !!viewAs && !(wallet && viewAs.equals(wallet));
  const positions = readOnly ? viewed : app.positions;
  const refreshAll = () => {
    app.refreshAll();
    viewed.refresh();
  };

  if (!wallet && !viewAs) {
    return (
      <>
        <PageHeader title="Portfolio" sub="Your cover and positions, and anything ready to claim." />
        <div className="rounded-xl border border-line bg-panel px-6 py-10 text-center">
          <p className="text-sm text-muted">Connect a wallet to see your cover and positions.</p>
          <button onClick={() => setVisible(true)} className="mt-4 rounded-lg bg-bell px-5 py-2.5 text-sm font-medium text-bg">
            Connect wallet
          </button>
        </div>
      </>
    );
  }

  const rows: Row[] = (positions.data ?? []).flatMap((p) => {
    const m = marketByAddress.get(p.market);
    return m ? [{ p, m }] : [];
  });
  const owedOf = (r: Row) => positionPayout(r.m, r.p.yesAmount, r.p.noAmount) ?? 0n;
  const settled = rows.filter((r) => r.m.status !== "open");
  const toClaim = settled.filter((r) => owedOf(r) > 0n);
  const toClose = settled.filter((r) => owedOf(r) === 0n);
  const open = rows.filter((r) => r.m.status === "open");
  const openSeries = groupSeries(open.map((r) => r.m));
  const staked = open.reduce((a, r) => a + r.p.yesAmount + r.p.noAmount, 0n);
  const owedTotal = toClaim.reduce((a, r) => a + owedOf(r), 0n);

  async function claim(list: Row[], label: string, key: string) {
    if (!wallet || list.length === 0) return;
    setBusy(key);
    try {
      const program = getProgram(connection);
      let sig = "";
      for (let i = 0; i < list.length; i += CLAIMS_PER_TX) {
        const chunk = list.slice(i, i + CLAIMS_PER_TX).map((r) => new PublicKey(r.m.address));
        sig = await sendIxs(await claimManyIxs(program, { markets: chunk, owner: wallet }));
      }
      notify(label, sig);
      refreshAll();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function settle(markets: MarketView[], key: string) {
    setBusy(key);
    try {
      const sig = await settleMarkets(markets.map((m) => m.address));
      notify("Settled from Pyth", sig);
      refreshAll();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Portfolio"
        sub={
          readOnly
            ? `Viewing ${shortAddress(viewAs!.toBase58())}, read-only. Positions are public on-chain; only the owner can claim.`
            : "Your cover and positions. Settled positions can be claimed as soon as the market settles."
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        <Tile
          label="Balance"
          value={readOnly ? "—" : balance.data == null ? "…" : tokens(balance.data)}
          hint={readOnly ? "owner only" : COLLATERAL_SYMBOL}
        />
        <Tile label="In open positions" value={tokens(staked)} hint={`${open.length} position${open.length === 1 ? "" : "s"}`} />
        <Tile label="Ready to claim" value={tokens(owedTotal)} hint={`${toClaim.length} settled`} accent={owedTotal > 0n} />
        <Tile label="Next settlement" value={openSeries[0] ? countdown(openSeries[0].resolveTs - now) : "—"}
          hint={openSeries[0] ? etTime(openSeries[0].resolveTs, false) : "nothing open"} />
      </div>

      {!positions.data && !positions.error ? (
        <Skeleton className="mt-6 h-64" />
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-panel px-6 py-10 text-center text-sm text-muted">
          Nothing here yet.{" "}
          <Link href="/cover" className="text-bell underline">
            Buy cover
          </Link>{" "}
          or{" "}
          <Link href="/markets" className="text-bell underline">
            trade a strike
          </Link>
          .
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {toClaim.length > 0 && (
            <Section
              title="Ready to claim"
              action={
                readOnly ? null : <button
                  onClick={() => claim(toClaim, `Claimed ${tokens(owedTotal)} ${COLLATERAL_SYMBOL}`, "claim-all")}
                  disabled={!!busy}
                  className="rounded-lg bg-bell px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
                >
                  {busy === "claim-all" ? "Claiming…" : `Claim ${tokens(owedTotal)} ${COLLATERAL_SYMBOL}`}
                </button>
              }
            >
              {toClaim.map((r) => (
                <PositionRow key={r.p.address} r={r} right={<span className="num text-yes">+{tokens(owedOf(r))}</span>}>
                  {r.m.status === "voided"
                    ? "Voided: full refund"
                    : `Settled at ${usd(r.m.settlePrice!, 4)}: ${r.m.outcome?.toUpperCase()} won`}
                </PositionRow>
              ))}
            </Section>
          )}

          {openSeries.map((s) => {
            const symbol = stockByEquityFeed(s.feedId)?.symbol ?? "?";
            const mine = open.filter((r) => r.m.resolveTs === s.resolveTs && r.m.feedId === s.feedId);
            const due = now >= s.resolveTs;
            // Cover reads best as a staircase: what you receive if the stock settles below each strike.
            const cover = mine
              .filter((r) => r.p.noAmount > 0n)
              .sort((a, b) => b.m.strike - a.m.strike)
              .map((r, i, arr) => ({
                strike: r.m.strike,
                total: arr.slice(0, i + 1).reduce((a, x) => a + currentPayout(x.m, "no", x.p.noAmount), 0n),
              }));
            const key = `settle:${s.resolveTs}`;
            return (
              <Section
                key={`${s.feedId}:${s.resolveTs}`}
                title={`${symbol} · settles ${etTime(s.resolveTs, false)}`}
                sub={due ? "Settlement time has passed" : `in ${countdown(s.resolveTs - now)}`}
                action={
                  due ? (
                    <button
                      onClick={() => settle(s.markets, key)}
                      disabled={!!busy}
                      className="rounded-lg bg-bell px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
                    >
                      {busy === key ? "Posting Pyth price…" : "Settle now"}
                    </button>
                  ) : null
                }
              >
                {cover.length > 0 && (
                  <div className="border-b border-line bg-panel-2 px-5 py-3">
                    <div className="text-xs uppercase tracking-wider text-bell">Your cover</div>
                    <ul className="num mt-1.5 space-y-0.5 text-sm">
                      {cover.map((c) => (
                        <li key={c.strike}>
                          If {symbol} settles below <span className="text-text">{usd(c.strike)}</span>, you receive{" "}
                          <span className="text-yes">~{tokens(c.total)}</span> {COLLATERAL_SYMBOL}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {mine
                  .sort((a, b) => b.m.strike - a.m.strike)
                  .map((r) => (
                    <PositionRow key={r.p.address} r={r} right={<span className="num text-muted">{tokens(r.p.yesAmount + r.p.noAmount)} staked</span>}>
                      {r.p.noAmount > 0n && <>NO {tokens(r.p.noAmount)}: pays ~{tokens(currentPayout(r.m, "no", r.p.noAmount))} below {usd(r.m.strike)}. </>}
                      {r.p.yesAmount > 0n && <>YES {tokens(r.p.yesAmount)}: pays ~{tokens(currentPayout(r.m, "yes", r.p.yesAmount))} at or above {usd(r.m.strike)}.</>}
                    </PositionRow>
                  ))}
                <p className="px-5 py-2.5 text-xs text-faint">
                  Estimates at current pools; they move until betting closes at {etTime(s.lockTs, false)}.
                </p>
              </Section>
            );
          })}

          {toClose.length > 0 && (
            <Section
              title="Settled, nothing owed"
              sub="Closing returns the small account deposit."
              action={
                readOnly ? null : <button
                  onClick={() => claim(toClose, "Closed settled positions", "close-all")}
                  disabled={!!busy}
                  className="rounded-lg border border-line px-4 py-2 text-sm hover:border-faint disabled:opacity-50"
                >
                  {busy === "close-all" ? "Closing…" : "Close all"}
                </button>
              }
            >
              {toClose.map((r) => (
                <PositionRow key={r.p.address} r={r} right={<span className="num text-faint">0.00</span>}>
                  Settled at {usd(r.m.settlePrice ?? 0, 4)}: {r.m.outcome?.toUpperCase()} won
                </PositionRow>
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-1 text-xl ${accent ? "text-bell" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

function Section({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {sub && <p className="text-xs text-faint">{sub}</p>}
        </div>
        {action}
      </header>
      <div className="divide-y divide-line/60">{children}</div>
    </section>
  );
}

function PositionRow({ r, right, children }: { r: Row; right: React.ReactNode; children: React.ReactNode }) {
  const symbol = stockByEquityFeed(r.m.feedId)?.symbol ?? "?";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
      <div className="min-w-0">
        <a href={explorerAddress(r.m.address)} target="_blank" rel="noreferrer" className="font-medium hover:text-bell">
          {symbol} ≥ <span className="num">{usd(r.m.strike)}</span>
        </a>
        <div className="num text-xs text-muted">{children}</div>
      </div>
      {right}
    </div>
  );
}
