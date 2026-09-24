import { explorerAddress, PROGRAM_ID } from "@/lib/config";
import { etTime } from "@/lib/format";
import { Series } from "@/lib/ladder";
import { pythFeedUrl, Stock } from "@/lib/stocks";

/**
 * The resolution rules for a ladder, stated before anyone trades: what YES
 * means, where the price comes from, what the program checks, and when money
 * moves. Every number here is read from the market accounts.
 */
export function SeriesRules({ series, stock }: { series: Series; stock: Stock }) {
  const m = series.markets[0];
  const windowSecs = m.resolveWindowSecs;
  const confPct = (m.maxConfBps / 100).toFixed(m.maxConfBps % 100 ? 2 : 0);
  const voidHours = Math.round((windowSecs + m.voidDelaySecs) / 3600);

  return (
    <div className="flex flex-col gap-4 text-xs leading-relaxed text-muted">
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Rules</div>
        <p>
          Each strike resolves <span className="text-yes">YES</span> if the first Pyth{" "}
          <span className="text-text">{stock.pythSymbol}</span> price published at or after{" "}
          <span className="text-text">{etTime(series.resolveTs)}</span> is at or above the strike, and{" "}
          <span className="text-no">NO</span> otherwise.
        </p>
        <a href={pythFeedUrl(stock)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-bell underline">
          Price source: Pyth {stock.pythSymbol} ↗
        </a>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Checked on-chain</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Signed Pyth update, verified through Wormhole</li>
          <li>Right feed, positive price</li>
          <li>Published within {windowSecs}s of the deadline, and the print before it was earlier</li>
          <li>Confidence within {confPct}% of the price</li>
        </ul>
        <p className="mt-1">Anyone can submit it; there is no proposer, vote or dispute window.</p>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Timeline and payout</div>
        <dl className="space-y-0.5">
          <Row k="Betting closes" v={etTime(series.lockTs, false)} />
          <Row k="Settles" v={`${etTime(series.resolveTs, false)} print`} />
          <Row k="Payout" v="Claimable as soon as it settles" />
        </dl>
      </div>

      <p>
        Refunds: a strike with money on only one side refunds everyone once betting closes. If no valid print lands in
        the {windowSecs}s window, anyone can void it {voidHours}h after the deadline and every stake is returned. No
        fees.{" "}
        <a href={explorerAddress(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer" className="underline hover:text-text">
          Program
        </a>
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="num text-right text-text">{v}</dd>
    </div>
  );
}
