"use client";

import { useState } from "react";

import { etTime } from "@/lib/format";

import { useApp } from "../AppState";
import { SeriesCard, seriesPhase } from "../SeriesCard";
import { PageHeader } from "../Shell";
import { Skeleton } from "../Skeleton";
import { StockTabs } from "../StockTabs";

export function MarketsView() {
  const app = useApp();
  const { stock, series, prices, balance, now, markets } = app;
  const [pickedTs, setPickedTs] = useState<number | null>(null);

  // Live ladders first (soonest to settle), then settled ones (most recent first).
  const stockSeries = series
    .filter((s) => s.feedId === stock?.equityFeedId)
    .sort((a, b) => {
      const done = (x: typeof a) => (seriesPhase(x, now) === "settled" ? 1 : 0);
      return done(a) - done(b) || (done(a) ? b.resolveTs - a.resolveTs : a.resolveTs - b.resolveTs);
    });
  const current = stockSeries.find((s) => s.resolveTs === pickedTs) ?? stockSeries[0];

  return (
    <>
      <PageHeader
        title={stock ? `Where will ${stock.symbol} print at the bell?` : "Markets"}
        sub="Each strike is a YES/NO pool that settles on the first Pyth price at or after the deadline. Winners split the pool. No house, no fee."
      >
        <StockTabs />
      </PageHeader>

      {markets.error && <p className="mb-4 text-sm text-no">Could not load markets from devnet: {markets.error}</p>}
      {!markets.data && !markets.error ? (
        <Skeleton className="h-[640px]" />
      ) : !stock || !current ? (
        <p className="rounded-xl border border-line bg-panel px-5 py-6 text-sm text-muted">No ladders yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div role="tablist" aria-label="Settlement time" className="flex flex-wrap gap-2">
            {stockSeries.map((s) => {
              const phase = seriesPhase(s, now);
              const on = s === current;
              return (
                <button
                  key={s.resolveTs}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPickedTs(s.resolveTs)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition ${
                    on ? "border-bell bg-bell-soft text-text" : "border-line text-muted hover:border-faint"
                  }`}
                >
                  {etTime(s.resolveTs, false)}
                  <span className={`ml-2 ${phase === "open" ? "text-yes" : "text-faint"}`}>
                    {phase === "open" ? "open" : phase === "settled" ? "settled" : phase === "due" ? "settling" : "locked"}
                  </span>
                </button>
              );
            })}
          </div>
          <SeriesCard
            key={`${current.feedId}:${current.resolveTs}`}
            series={current}
            stock={stock}
            quote={prices.data?.[stock.equityFeedId]}
            balance={balance.data}
            now={now}
            onChanged={app.refreshAll}
            notify={app.notify}
          />
        </div>
      )}
    </>
  );
}
