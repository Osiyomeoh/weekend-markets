"use client";

import Link from "next/link";

import { pct, usd } from "@/lib/format";
import { usePreStocks } from "@/lib/hooks";

import { useApp } from "../AppState";
import { PageHeader } from "../Shell";
import { Skeleton } from "../Skeleton";

const billions = (x: number) => `$${(x / 1e9).toLocaleString("en-US", { maximumFractionDigits: 0 })}B`;

/**
 * The same idea as gap cover, for companies that don't trade at all: a
 * PreStocks token trades around the clock, so the distance between its price
 * and PreStocks' own mark is what a buyer pays over (or under) the underlying.
 */
export function PreIpoView() {
  const { wallet } = useApp();
  const data = usePreStocks(wallet);
  const tokens = data.data?.tokens ?? [];
  const held = (data.data?.holdings ?? []).flatMap((h) => {
    const t = tokens.find((x) => x.symbol === h.symbol);
    return t ? [{ ...h, t }] : [];
  });

  return (
    <>
      <PageHeader
        title="Pre-IPO gap"
        sub="PreStocks tokens put private companies on Solana. The tokens trade around the clock; the companies don't trade at all. This is how far each token trades from PreStocks' own mark for the company: the premium or discount a buyer pays today."
      />

      <div className="flex flex-col gap-6">
        {held.length > 0 && (
          <div className="rounded-xl border border-bell/30 bg-bell-soft px-5 py-4 text-sm">
            <div className="text-xs uppercase tracking-wider text-bell">Your pre-IPO tokens, from mainnet</div>
            <ul className="num mt-2 space-y-1">
              {held.map(({ symbol, amount, t }) => (
                <li key={symbol} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} {symbol}
                  </span>
                  <span className="text-muted">
                    {usd(amount * t.tokenPrice)} at the market · {usd(amount * t.markPrice)} at the mark
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.error && <p className="text-sm text-no">Could not load PreStocks data: {data.error}</p>}
        {!data.data && !data.error ? (
          <Skeleton className="h-[420px]" />
        ) : (
          <div className="rounded-xl border border-line bg-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-5 py-3 font-normal">Company</th>
                  <th className="px-3 py-3 text-right font-normal">Token</th>
                  <th className="hidden px-3 py-3 text-right font-normal sm:table-cell">PreStocks mark</th>
                  <th className="px-3 py-3 text-right font-normal">Gap</th>
                  <th className="hidden px-5 py-3 text-right font-normal md:table-cell">Valued at the mark</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.symbol} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-3">
                      <a href={t.url} target="_blank" rel="noreferrer" className="font-medium hover:text-bell">
                        {t.name}
                      </a>
                      <div className="num text-xs text-faint">
                        {t.symbol}
                        {t.pythIndex && <span className="text-bell"> · Pyth index</span>}
                      </div>
                    </td>
                    <td className="num px-3 py-3 text-right">{usd(t.tokenPrice)}</td>
                    <td className="num hidden px-3 py-3 text-right text-muted sm:table-cell">{usd(t.markPrice)}</td>
                    <td className={`num px-3 py-3 text-right ${Math.abs(t.gap) >= 0.1 ? "text-bell" : "text-text"}`}>
                      {pct(t.gap, 1)}
                      <div className="text-[11px] text-faint">{t.gap >= 0 ? "premium" : "discount"}</div>
                    </td>
                    <td className="num hidden px-5 py-3 text-right text-muted md:table-cell">
                      {billions(t.markValuation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
          <div className="bg-panel px-6 py-5">
            <div className="font-medium">Cover for pre-IPO holders, settled by Pyth</div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Pyth already publishes <span className="num text-text">Equity.Index.OPENAI/USD</span> and{" "}
              <span className="num text-text">Equity.Index.ANTHROPIC/USD</span> around the clock. Once they&apos;re
              enabled for our key, OpenAI and Anthropic holders get the same ladders and cover as TSLAx holders, settled
              by Pyth rather than by any issuer&apos;s own mark.
            </p>
          </div>
          <div className="bg-panel px-6 py-5">
            <div className="font-medium">For agents too</div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              The <span className="num text-text">pre_ipo_gap</span> tool on our MCP server gives any agent this table.{" "}
              <Link href="/#agents" className="underline hover:text-text">
                Add it by URL
              </Link>
              .
            </p>
          </div>
        </div>

        <p className="text-xs text-faint">
          Token prices and marks from PreStocks&apos; public API, refreshed every minute. Display only: nothing here
          settles on them. Holdings are read from Solana mainnet, read-only.
        </p>
      </div>
    </>
  );
}
