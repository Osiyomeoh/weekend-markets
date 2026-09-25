"use client";

import Link from "next/link";

import { etTime } from "@/lib/format";

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
