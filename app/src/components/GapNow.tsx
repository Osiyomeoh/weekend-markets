"use client";

import { countdown, pct, usd } from "@/lib/format";
import { nextOpeningBell, usSession } from "@/lib/sessions";
import { Stock } from "@/lib/stocks";

import { useApp } from "./AppState";

/**
 * The gap as it forms: where the stock's tokens trade on Solana right now
 * against the stock's latest Pyth price. When Wall Street is closed, the
 * difference is what the next opening print is likely to deliver at once.
 * Display only; settlement uses the Pyth equity feed.
 */
export function GapNow({ stock }: { stock: Stock }) {
  const { prices, tokenPrices, now } = useApp();
  const quote = prices.data?.[stock.equityFeedId];
  // Trust the data over the calendar: no Pyth print for half an hour means no
  // trading (a holiday, or a feed pause), whatever the clock says.
  const session = quote && now - quote.publishTime > 1800 ? "closed" : usSession(now);

  // Prefer Pyth's own 24/7 xStock feed when our key can read it; otherwise Jupiter.
  const pythX = prices.data?.[stock.xstockFeedId];
  const tokens = stock.tokenized.flatMap((t) => {
    const fromPyth = t.issuer === "xStocks" ? pythX : undefined;
    const price = fromPyth?.price ?? tokenPrices.data?.[t.mint]?.price;
    return price ? [{ symbol: t.symbol, price, source: fromPyth ? "Pyth" : "Jupiter" }] : [];
  });
  if (!quote || tokens.length === 0) return null;

  const lead = tokens[0];
  const drift = lead.price / quote.price - 1;
  const openIn = nextOpeningBell(now, 0, 0) - now;
  const tone = Math.abs(drift) < 0.001 ? "text-text" : drift > 0 ? "text-yes" : "text-no";

  const headline =
    session === "regular" ? (
      <>
        The market is open: {lead.symbol} is tracking {stock.symbol} within{" "}
        <span className={`num ${tone}`}>{pct(Math.abs(drift), 2).replace("+", "")}</span>.
      </>
    ) : session === "extended" ? (
      <>
        {stock.symbol} is in thin pre-market, after-hours or overnight trading. {lead.symbol} is{" "}
        <span className={`num ${tone}`}>{pct(drift, 2)}</span> from its latest print.
      </>
    ) : (
      <>
        Wall Street is closed. {lead.symbol} is trading <span className={`num ${tone}`}>{pct(drift, 2)}</span> from{" "}
        {stock.symbol}&apos;s last price. That&apos;s the gap forming.
      </>
    );

  return (
    <div className="rounded-xl border border-line bg-panel px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-bell">Right now</span>
        <span
          className={`num rounded-full px-2.5 py-0.5 text-[11px] ${
            session === "regular" ? "bg-yes-soft text-yes" : "bg-bell-soft text-bell"
          }`}
        >
          {session === "regular" ? "Regular session" : session === "extended" ? "Extended hours" : "Closed"} ·
          {session === "regular" ? " closes 16:00 ET" : ` opening bell in ${countdown(openIn)}`}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed sm:text-base">{headline}</p>
      <dl className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <div>
          <dt className="inline">{stock.symbol} on Pyth </dt>
          <dd className="inline text-text">{usd(quote.price)}</dd>
          <dd className="inline"> · {now - quote.publishTime < 120 ? "live" : "last print"}</dd>
        </div>
        {tokens.map((t) => (
          <div key={t.symbol}>
            <dt className="inline">{t.symbol} on Solana </dt>
            <dd className="inline text-text">{usd(t.price)}</dd>
            <dd className="inline">
              {" "}
              · {pct(t.price / quote.price - 1, 2)} · via {t.source}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
