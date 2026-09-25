"use client";

import Link from "next/link";

import history from "@/data/tsla-gaps.json";
import { etTime, pct, usd } from "@/lib/format";
import { backtestCover, MIN_HISTORY, openingHistory } from "@/lib/gapModel";
import { STOCKS } from "@/lib/stocks";

import { useApp } from "../AppState";
import { CoverPanel } from "../CoverPanel";
import { GapNow } from "../GapNow";
import { GetStarted } from "../GetStarted";
import { PageHeader } from "../Shell";
import { StockTabs } from "../StockTabs";
import { Skeleton } from "../Skeleton";

export function CoverView() {
  const app = useApp();
  const { wallet, balance, stock, series, prices, holdings, now, myMarkets, markets } = app;
  const stockSeries = series.filter((s) => s.feedId === stock?.equityFeedId);
  const active = myMarkets.filter((m) => m.status === "open");
  const claimable = myMarkets.filter((m) => m.status !== "open").length;
  const funded = (balance.data ?? 0n) > 0n;
  const onboarding = !wallet || !funded || (active.length === 0 && claimable === 0);
  const nextSettle = [...new Set(active.map((m) => m.resolveTs))].sort((a, b) => a - b)[0];

  return (
    <>
      <PageHeader
        title="Gap cover"
        sub="Protection for a stock position until the next opening print. Built from NO stakes on the strike ladder, settled by Pyth."
      >
        <StockTabs />
      </PageHeader>

      <div className="flex flex-col gap-6">
        {onboarding ? (
          <GetStarted
            connected={!!wallet}
            funded={funded}
            fauceting={app.fauceting}
            hasOpen={active.length > 0}
            claimable={claimable}
            nextSettle={stockSeries.find((s) => s.resolveTs > now)?.resolveTs ?? null}
            onFaucet={app.faucet}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-yes/30 bg-yes-soft px-5 py-3 text-sm">
            <span>
              {active.length > 0
                ? `You have cover on ${active.length} strike${active.length > 1 ? "s" : ""}, settling ${etTime(nextSettle, false)}.`
                : `${claimable} settled position${claimable > 1 ? "s" : ""} ready to claim.`}
            </span>
            <Link href="/portfolio" className="font-medium text-yes underline">
              View in portfolio
            </Link>
          </div>
        )}

        {stock && <GapNow stock={stock} />}
        {stock?.symbol === "TSLA" && <OpenHistoryNote />}

        {markets.error && <p className="text-sm text-no">Could not load markets from devnet: {markets.error}</p>}
        {!markets.data && !markets.error ? (
          <Skeleton className="h-[560px]" />
        ) : stock ? (
          <div id="cover" className="scroll-mt-24">
            <CoverPanel
              stock={stock}
              series={stockSeries}
              quote={prices.data?.[stock.equityFeedId]}
              holdings={holdings.data ?? []}
              balance={balance.data}
              now={now}
              onChanged={app.refreshAll}
              notify={app.notify}
            />
          </div>
        ) : (
          <p className="rounded-xl border border-line bg-panel px-5 py-6 text-sm text-muted">
            No ladders are open right now.
          </p>
        )}

        <p className="text-xs text-faint">
          How the cover is built and why it never pays more than you lose:{" "}
          <Link href="/#how" className="underline hover:text-text">
            how it works
          </Link>
          . Prefer to take a view instead?{" "}
          <Link href="/markets" className="underline hover:text-text">
            Trade the ladder
          </Link>
          .
        </p>
      </div>
    </>
  );
}

/** What the opening print has done lately, from Pyth history (see the landing page's chart). */
const TSLA = STOCKS.find((s) => s.symbol === "TSLA")!;

function OpenHistoryNote() {
  const gaps = history.gaps;
  if (gaps.length === 0) return null;
  const over2 = gaps.filter((g) => Math.abs(g.gap) > 0.02).length;
  const worst = gaps.reduce((a, g) => (Math.abs(g.gap) > Math.abs(a.gap) ? g : a));
  const date = new Date(`${worst.to}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const bt = backtestCover(TSLA, openingHistory(TSLA), 10);
  const btStart = new Date(`${bt.nights[MIN_HISTORY].to}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <p className="-mt-3 text-xs text-muted">
      Since July, Tesla&apos;s open has moved more than 2% from the previous close on {over2} of {gaps.length} days. The
      largest was {pct(worst.gap, 1)} on {date}: {usd(10 * worst.close * Math.abs(worst.gap), 0)} on 10 shares, at the
      bell. Replayed on the {bt.priced.nights} openings since {btStart}, cover like this, priced only from the
      openings before each one, paid back {Math.round((bt.priced.paid / bt.priced.cost) * 100)}¢ per dollar.{" "}
      <Link href="/#problem" className="underline hover:text-text">
        Every open, and the backtest
      </Link>
    </p>
  );
}
