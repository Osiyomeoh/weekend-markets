import { pct, usd } from "@/lib/format";
import { backtestCover, MIN_HISTORY, openingHistory } from "@/lib/gapModel";
import { STOCKS } from "@/lib/stocks";

const SHARES = 10;
const TSLA = STOCKS.find((s) => s.symbol === "TSLA")!;

const day = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}`;

/**
 * Cover replayed on every TSLA opening since July with the code the keeper
 * and the Cover page run (gapModel.ts, cover.ts): priced at each close only
 * from the openings before it, paid by the actual opening print.
 */
export function CoverBacktest() {
  const bt = backtestCover(TSLA, openingHistory(TSLA), SHARES);
  const t = bt.priced;
  if (t.nights === 0) return null;
  const paidNights = bt.nights.filter((n) => n.source === "history" && n.paid > 0);
  const smallestPaid = Math.min(...paidNights.map((n) => Math.abs(n.gap)));
  const returned = t.paid / t.cost;

  return (
    <div className="mt-6 rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <span className="text-xs uppercase tracking-wider text-muted">
          Backtest: cover on {SHARES} TSLA, every night since {day(bt.nights[MIN_HISTORY].to)}
        </span>
        <span className="num text-xs text-muted">
          {t.nights} openings · priced only from the openings before each one
        </span>
      </div>
      <div className="grid gap-px bg-line sm:grid-cols-3">
        {[
          [`${Math.round(returned * 100)}¢`, `paid back per $1 of cover: ${usd(t.cost, 0)} paid in, ${usd(t.paid, 0)} paid out`],
          [
            `${paidNights.length} of ${t.nights}`,
            `openings it paid on, each more than ${pct(-smallestPaid, 1).replace("-", "")} down; up opens cost only the premium`,
          ],
          [
            `${(t.lognormalCost / t.cost).toFixed(1)}×`,
            "what our launch pricing charged for the same cover. Ladders are now seeded from this history.",
          ],
        ].map(([value, label]) => (
          <div key={label} className="bg-panel px-5 py-4">
            <div className="num text-2xl font-semibold tracking-tight">{value}</div>
            <div className="mt-1 text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>
      <table className="num w-full border-t border-line text-sm">
        <caption className="sr-only">Openings where the backtested cover paid</caption>
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="px-5 py-2 font-normal">Opening</th>
            <th className="px-3 py-2 font-normal">Move</th>
            <th className="hidden px-3 py-2 text-right font-normal sm:table-cell">Shares lost</th>
            <th className="px-3 py-2 text-right font-normal">Cost</th>
            <th className="px-5 py-2 text-right font-normal">Cover paid</th>
          </tr>
        </thead>
        <tbody>
          {paidNights.map((n) => (
            <tr key={n.to} className="border-t border-line/60">
              <td className="px-5 py-2.5">{day(n.to)}</td>
              <td className="px-3 py-2.5 text-no">{pct(n.gap, 2)}</td>
              <td className="hidden px-3 py-2.5 text-right text-muted sm:table-cell">{usd(n.loss, 0)}</td>
              <td className="px-3 py-2.5 text-right text-muted">{usd(n.cost, 2)}</td>
              <td className="px-5 py-2.5 text-right text-yes">{usd(n.paid, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-5 pb-4 pt-3 text-xs leading-relaxed text-faint">
        At each close: a five-strike ladder seeded the way the keeper seeds one, from the openings before it only; the
        Cover page&apos;s default range (from the first strike 1% or more below the close down to the lowest); paid by
        the first Pyth print at or after 09:30 ET. Cover has a deductible and a cap, so on those nights it paid{" "}
        {usd(t.paid, 0)} of the {usd(t.loss, 0)} the shares lost. The first {MIN_HISTORY} openings had too little history
        and are left out of the totals, including {day(bt.nights[0].to)}, when the launch pricing&apos;s cover would have paid{" "}
        {usd(bt.nights[0].paid, 0)} for {usd(bt.nights[0].cost, 0)}.
      </p>
    </div>
  );
}
