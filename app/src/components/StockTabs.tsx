"use client";

import { usd } from "@/lib/format";
import { STOCKS } from "@/lib/stocks";

import { useApp } from "./AppState";

/** Stock picker. Stocks without a ladder yet are shown but disabled. */
export function StockTabs() {
  const { prices, listed, stock, setSymbol } = useApp();
  return (
    <div role="tablist" aria-label="Stock" className="flex flex-wrap gap-2">
      {STOCKS.map((s) => {
        const q = prices.data?.[s.equityFeedId];
        const has = listed.includes(s);
        const on = s === stock;
        return (
          <button
            key={s.symbol}
            role="tab"
            aria-selected={on}
            onClick={() => setSymbol(s.symbol)}
            disabled={!has}
            title={has ? undefined : "No ladder yet: this Pyth feed isn't enabled for our key"}
            className={`rounded-lg border px-4 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
              on ? "border-bell bg-bell-soft" : "border-line bg-panel hover:border-faint"
            }`}
          >
            <div className="text-sm font-medium">{s.symbol}</div>
            <div className="num text-xs text-muted">{q ? usd(q.price) : has ? "…" : "soon"}</div>
          </button>
        );
      })}
    </div>
  );
}
