"use client";

import Link from "next/link";

import { COLLATERAL_DECIMALS, COLLATERAL_SYMBOL, explorerAddress } from "@/lib/config";
import { CoverPlan, coverPlan } from "@/lib/cover";
import { countdown, etDate, etTime, pct, tokens, usd } from "@/lib/format";
import { impliedMedian, impliedProbability, MarketView, seriesCurve } from "@/lib/ladder";
import { pythFeedUrl, STOCKS } from "@/lib/stocks";

import { useApp } from "../AppState";
import { CurveChart } from "../CurveChart";
import { GapNow } from "../GapNow";
import { PayoffChart } from "../PayoffChart";
import { seriesPhase } from "../SeriesCard";

const UNIT = 10 ** COLLATERAL_DECIMALS;
const EXAMPLE_SHARES = 10;
const TSLA = STOCKS.find((s) => s.symbol === "TSLA")!;

export function Landing() {
  const { prices, series, now, markets } = useApp();
  const quote = prices.data?.[TSLA.equityFeedId];
  const spot = quote?.price;
  const tslaSeries = series.filter((s) => s.feedId === TSLA.equityFeedId);
  const open = tslaSeries.filter((s) => seriesPhase(s, now) === "open");
  // The longest open horizon is the one that spans the weekend.
  const weekend = open.at(-1);
  const from =
    weekend && spot
      ? weekend.markets
          .map((m) => m.strike)
          .filter((k) => k <= spot * 0.99)
          .sort((a, b) => b - a)[0]
      : undefined;
  const plan = weekend && spot ? coverPlan(weekend.markets, spot, EXAMPLE_SHARES, UNIT, { from }) : null;
  const curve = weekend ? seriesCurve(weekend) : [];
  const median = impliedMedian(curve);
  const openPool = (markets.data ?? [])
    .filter((m) => m.status === "open")
    .reduce((a, m) => a + m.yesPool + m.noPool, 0n);
  const lastSettled = (markets.data ?? [])
    .filter((m) => m.status === "resolved" && m.settlePublishTime !== null)
    .sort((a, b) => b.resolveTs - a.resolveTs || a.strike - b.strike);
  const receipt = lastSettled[0];
  const receiptLadder = receipt ? lastSettled.filter((m) => m.resolveTs === receipt.resolveTs) : [];

  return (
    <div className="flex flex-col gap-20 pb-8 sm:gap-24">
      {/* Hero */}
      <section className="pt-4 sm:pt-10">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-bell">
              Gap cover for tokenized stocks
            </div>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Hedge the hours Wall Street is closed.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              TSLAx and TSLAon trade around the clock on Solana. Tesla&apos;s regular session is 32.5 hours a week, and
              from Friday evening to Sunday evening nothing trades it at all. Whatever happens in between lands on the
              next opening print. Weekend Markets pays you if it opens lower, settled on-chain by the first Pyth price
              after the bell.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/cover"
                className="rounded-lg bg-bell px-6 py-3 text-sm font-semibold text-bg transition hover:brightness-110"
              >
                Protect my TSLA
              </Link>
              <Link
                href="/markets"
                className="rounded-lg border border-line px-6 py-3 text-sm font-medium transition hover:border-faint"
              >
                Trade the ladder
              </Link>
            </div>
          </div>

          <LiveQuote plan={plan} spot={spot} until={weekend?.resolveTs} />
        </div>

        <div className="mt-10">
          <GapNow stock={TSLA} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          <Stat
            label="Pyth TSLA"
            value={spot !== undefined ? usd(spot) : "…"}
            hint={quote ? ago(now - quote.publishTime) : "live price"}
          />
          <Stat
            label={weekend ? `Crowd forecast, ${etDate(weekend.resolveTs)} open` : "Crowd forecast"}
            value={median !== null ? usd(median) : "…"}
            hint={median !== null && spot !== undefined ? `${pct(median / spot - 1, 2)} vs now` : "from the pools"}
            accent
          />
          <Stat label="In open pools" value={`${tokens(openPool, 0)}`} hint={COLLATERAL_SYMBOL} />
          <Stat
            label="Next settlement"
            value={open[0] ? countdown(open[0].resolveTs - now) : "…"}
            hint={open[0] ? etTime(open[0].resolveTs, false) : "first Pyth print after"}
          />
        </dl>
      </section>

      {/* The gap */}
      <section>
        <SectionTitle
          eyebrow="The problem"
          title="The token trades 168 hours a week. Tesla's regular session is 32.5."
          sub="Outside it, trading is thin (pre-market, after-hours, overnight venues), and from Friday evening to Sunday evening nothing trades Tesla at all. Earnings after the close, news on a Saturday: it reaches the stock at once, on the next opening print. A TSLAx holder can't buy a put on a token in a Solana wallet, so today they either sell into thin weekend liquidity or take the jump."
        />
        <WeekStrip />
      </section>

      {/* How cover works */}
      <section id="how" className="scroll-mt-24">
        <SectionTitle eyebrow="How it works" title="Cover sized to your position, paid by the print." />
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
          {[
            [
              "Tell it what you hold",
              "Enter your shares, or connect a wallet and it reads your TSLAx and TSLAon from mainnet, read-only.",
            ],
            [
              "Buy cover in one transaction",
              "A NO stake on each strike below the price, sized so the payout follows your loss down in steps. It never pays more than you lose.",
            ],
            [
              "Paid at the bell",
              "The program checks the first Pyth print after the deadline. Your payout is claimable seconds later. No claim forms, no vote.",
            ],
          ].map(([t, d], i) => (
            <div key={t} className="bg-panel px-6 py-5">
              <div className="num text-xs text-bell">0{i + 1}</div>
              <div className="mt-2 font-medium">{t}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The other side */}
      {weekend && curve.length > 0 && (
        <section>
          <SectionTitle
            eyebrow="The other side"
            title="Every strike is a market anyone can trade."
            sub="Cover is bought from the same YES/NO pools traders use to take a view on the open. Together the pools are the crowd's forecast of the next print."
          />
          <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="bg-panel px-3 py-3">
              <CurveChart
                curve={curve}
                raw={weekend.markets.flatMap((m) => {
                  const p = impliedProbability(m);
                  return p === null ? [] : [{ strike: m.strike, p }];
                })}
                markers={[
                  ...(spot !== undefined ? [{ x: spot, label: "Pyth now", color: "var(--text)" }] : []),
                  ...(median !== null ? [{ x: median, label: "Crowd 50%", color: "var(--bell)" }] : []),
                ]}
              />
            </div>
            <div className="flex flex-col justify-between gap-5 bg-panel px-6 py-5">
              <p className="text-sm leading-relaxed text-muted">
                The curve is the chance TSLA prints at or above each price at {etTime(weekend.resolveTs, false)}, read
                from the pool splits. Prices are quoted in cents, like any prediction market. Winners split the pool,
                with no house and no fee.
              </p>
              <Link
                href="/markets"
                className="self-start rounded-lg border border-line px-5 py-2.5 text-sm font-medium hover:border-faint"
              >
                Open the ladder
              </Link>
            </div>
          </div>
        </section>
      )}

      <ForAgents plan={plan} until={weekend?.resolveTs} />

      {/* Verified settlement */}
      <section>
        <SectionTitle
          eyebrow="Settlement"
          title="Nobody picks the number. Not even us."
          sub="Settlement is permissionless. The program only accepts the first Pyth price published at or after the deadline, verified through Wormhole, with its confidence band checked."
        />
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-2">
          <div className="bg-panel px-6 py-5">
            <div className="text-xs uppercase tracking-wider text-muted">The rule, on-chain</div>
            <pre className="num mt-3 overflow-x-auto rounded-lg bg-bg px-4 py-3 text-xs leading-relaxed text-text">
              {"prev_publish_time < resolve_ts\n  <= publish_time\n  <= resolve_ts + window"}
            </pre>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Requiring the previous print to be before the deadline means a settler can&apos;t shop for a better price
              inside the window. If no valid print arrives, every stake is refunded.
            </p>
            <a
              href={pythFeedUrl(TSLA)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-bell underline"
            >
              Pyth {TSLA.pythSymbol} ↗
            </a>
          </div>
          <div className="bg-panel px-6 py-5">
            <div className="text-xs uppercase tracking-wider text-muted">Latest settlement, from the chain</div>
            {receipt ? (
              <>
                <p className="mt-3 text-sm leading-relaxed">
                  TSLA ladder settled on a Pyth print of{" "}
                  <span className="num text-bell">{usd(receipt.settlePrice!, 4)}</span>, published{" "}
                  <span className="num">{etTime(receipt.settlePublishTime!)}</span>, the first at or after{" "}
                  <span className="num">{etTime(receipt.resolveTs)}</span>.
                </p>
                <ul className="num mt-3 space-y-1 text-sm">
                  {receiptLadder.map((m) => (
                    <li key={m.address} className="flex justify-between gap-3">
                      <a href={explorerAddress(m.address)} target="_blank" rel="noreferrer" className="hover:text-bell">
                        ≥ {usd(m.strike)}
                      </a>
                      <span className={m.outcome === "yes" ? "text-yes" : "text-no"}>
                        {m.outcome?.toUpperCase()} won
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">Loading from devnet…</p>
            )}
          </div>
        </div>
        <TrackRecord markets={markets.data ?? []} />
      </section>

      {/* Why Solana */}
      <section>
        <SectionTitle eyebrow="Why Solana" title="The holders, the price and the settlement are all on one chain." />
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
          {[
            [
              "The holders are here",
              "xStocks and Ondo tokenized stocks are Solana tokens. Cover reads what a wallet holds and settles in dollars on the same chain.",
            ],
            [
              "The price is verified, not trusted",
              "The signed Pyth update is checked through Wormhole and read by the program in the same transaction set. No proposer, committee or dispute window.",
            ],
            [
              "Settling costs about a cent",
              "A settlement is a couple of transactions, final seconds after the bell. That makes a fresh ladder per stock, per session, worth running.",
            ],
          ].map(([t, d]) => (
            <div key={t} className="bg-panel px-6 py-5">
              <div className="font-medium">{t}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section>
        <SectionTitle eyebrow="Compared" title="What's different from what's out there." />
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-5 py-3 font-normal" />
                <th className="px-4 py-3 font-normal">Polymarket</th>
                <th className="px-4 py-3 font-normal">Kalshi</th>
                <th className="px-4 py-3 font-normal">Nexus Mutual</th>
                <th className="px-5 py-3 font-medium text-bell">Weekend Markets</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {[
                ["Sized to what you hold", "No", "No", "You enter an amount", "Reads your TSLAx and TSLAon"],
                [
                  "How it resolves",
                  "Pyth data, proposed through UMA and open to dispute",
                  "Kalshi reads its source",
                  "Claim, proof of loss, member vote",
                  "Signed Pyth print checked by the program",
                ],
                [
                  "Time to payout",
                  "After the challenge period",
                  "About 3h after the close",
                  "14-day wait to file a claim",
                  "Seconds after settlement",
                ],
                ["Exit early", "Yes", "Yes", "n/a", "Not yet"],
              ].map(([k, ...cells]) => (
                <tr key={k} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="px-5 py-3 text-left font-normal text-text">
                    {k}
                  </th>
                  {cells.map((c, i) => (
                    <td key={i} className={`px-4 py-3 ${i === 3 ? "text-text" : ""}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <SectionTitle eyebrow="Questions" title="Straight answers." />
        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
          {[
            [
              "Is this insurance?",
              "No. Cover is a set of positions in open prediction markets. It pays by rule when the market settles, not by assessing a claim.",
            ],
            [
              "Is it real money?",
              "Not yet. This runs on Solana devnet with test USDC from the built-in faucet, so you can try the whole flow for free.",
            ],
            [
              "What if the stock doesn't open?",
              "If no valid Pyth print arrives in the settlement window, the market voids and every stake is refunded.",
            ],
            [
              "Can I sell before settlement?",
              "Not yet. Positions are held to the print, and payouts shown are estimates until betting closes. Early exit is next on the roadmap.",
            ],
          ].map(([q, a]) => (
            <div key={q} className="bg-panel px-6 py-5">
              <div className="font-medium">{q}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="rounded-2xl border border-bell/40 bg-bell-soft px-6 py-10 text-center sm:px-10">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Covered before the bell.</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Connect a wallet, take free test funds, and buy cover in about a minute.
        </p>
        <Link
          href="/cover"
          className="mt-6 inline-block rounded-lg bg-bell px-6 py-3 text-sm font-semibold text-bg hover:brightness-110"
        >
          Get started
        </Link>
      </section>
    </div>
  );
}

const AGENT_SETUP = `git clone https://github.com/Osiyomeoh/weekend-markets && cd weekend-markets/app && npm i
claude mcp add weekend-markets -- node "$PWD/node_modules/tsx/dist/cli.mjs" "$PWD/mcp/server.ts"`;

const ACTION_CALL = `POST https://weekend-markets.vercel.app/api/actions/cover?shares=10
{ "account": "<wallet address>" }  →  { "transaction": "<ready to sign>" }`;

/** The same cover, for agents: MCP tools, and a Solana Action any wallet can sign. */
function ForAgents({ plan, until }: { plan: CoverPlan | null; until: number | undefined }) {
  const legs = plan?.legs ?? [];
  return (
    <section>
      <SectionTitle
        eyebrow="For agents"
        title="Holders get an app. Agents get a tool."
        sub="An agent running a tokenized-stock portfolio holds over the weekend too. It can buy the same cover: through MCP tools for Claude and other agents, or through a Solana Action any wallet can sign. Cover never pays more than the position loses, so an agent can hedge with it but can't gamble with it."
      />
      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="bg-panel px-6 py-5">
          <div className="text-xs uppercase tracking-wider text-muted">Example, with today&apos;s prices</div>
          {legs.length > 0 && until !== undefined ? (
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <p className="max-w-[88%] self-end rounded-2xl rounded-br-sm bg-panel-2 px-4 py-2.5 leading-relaxed">
                I&apos;m holding {EXAMPLE_SHARES} TSLAx over the weekend. Protect me if Tesla opens Monday below{" "}
                {usd(legs[0].strike)}, and spend at most $100.
              </p>
              <div className="num flex flex-wrap gap-1.5 text-[11px] text-muted">
                {["gap_now", "quote_cover", "buy_cover"].map((t) => (
                  <span key={t} className="rounded-full border border-line px-2 py-0.5">
                    {t}
                  </span>
                ))}
              </div>
              <p className="max-w-[92%] leading-relaxed">
                Done. Cover for {EXAMPLE_SHARES} TSLA until {etTime(until, false)} cost{" "}
                <span className="num text-bell">
                  {tokens(plan!.cost)} {COLLATERAL_SYMBOL}
                </span>
                . If Tesla opens below {usd(legs[0].strike)} it pays{" "}
                <span className="num">{tokens(legs[0].payout)}</span>, rising to{" "}
                <span className="num">{tokens(plan!.maxPayout)}</span> below {usd(legs.at(-1)!.strike)}. It settles on
                the first Pyth print after the bell, and I&apos;ll claim whatever it pays.
              </p>
            </div>
          ) : (
            <div aria-hidden className="mt-4 h-40 animate-pulse rounded-lg bg-panel-2" />
          )}
        </div>
        <div className="flex flex-col gap-5 bg-panel px-6 py-5 text-sm">
          <div>
            <div className="font-medium">MCP server</div>
            <p className="mt-1 leading-relaxed text-muted">
              Nine tools: read the gap, quote and buy cover sized to shares or to what a mainnet wallet holds, follow
              it, settle, claim. The agent signs with its own devnet wallet, under a spending cap you set.
            </p>
            <pre className="num mt-2 rounded-lg bg-bg px-3 py-2 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-text">
              {AGENT_SETUP}
            </pre>
          </div>
          <div>
            <div className="font-medium">Solana Action</div>
            <p className="mt-1 leading-relaxed text-muted">
              Any wallet, Blink client or agent can send its address and get a ready-to-sign cover transaction. A new
              devnet wallet is funded in the same call.
            </p>
            <pre className="num mt-2 rounded-lg bg-bg px-3 py-2 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-text">
              {ACTION_CALL}
            </pre>
          </div>
          <a
            href="https://github.com/Osiyomeoh/weekend-markets#for-agents"
            target="_blank"
            rel="noreferrer"
            className="self-start text-bell underline"
          >
            Agent docs ↗
          </a>
        </div>
      </div>
    </section>
  );
}

/** A real quote from the live pools, for an example position. */
function LiveQuote({
  plan,
  spot,
  until,
}: {
  plan: CoverPlan | null;
  spot: number | undefined;
  until: number | undefined;
}) {
  if (!plan || plan.legs.length === 0 || spot === undefined || until === undefined) {
    return (
      <div aria-hidden className="hidden h-[360px] animate-pulse rounded-xl border border-line bg-panel lg:block" />
    );
  }
  const value = EXAMPLE_SHARES * spot;
  return (
    <div className="rounded-xl border border-bell/40 bg-panel shadow-[0_0_80px_-30px_var(--bell)]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="text-xs uppercase tracking-wider text-bell">Live quote</span>
        <span className="text-xs text-faint">until {etTime(until, false)}</span>
      </div>
      <div className="px-5 pt-4">
        <p className="text-sm text-muted">
          Cover <span className="text-text">{EXAMPLE_SHARES} TSLA</span> ({usd(value, 0)}) below{" "}
          <span className="num text-text">{usd(plan.legs[0].strike)}</span>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted">Costs</div>
            <div className="num text-2xl">{tokens(plan.cost)}</div>
            <div className="num text-xs text-faint">
              {((Number(plan.cost) / UNIT / value) * 100).toFixed(2)}% of position
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Pays up to</div>
            <div className="num text-2xl text-yes">{tokens(plan.maxPayout)}</div>
            <div className="num text-xs text-faint">below {usd(plan.legs.at(-1)!.strike)}</div>
          </div>
        </div>
      </div>
      <div className="px-2 pb-2 pt-1">
        <PayoffChart plan={plan} spot={spot} shares={EXAMPLE_SHARES} />
      </div>
    </div>
  );
}

type LadderRecord = {
  key: string;
  symbol: string;
  resolveTs: number;
  price: number | null;
  publishTime: number | null;
  yes: number;
  no: number;
  voided: number;
  link: string;
};

/** Every ladder that has finished, newest first: one Pyth print settles the whole ladder. */
function ladderRecords(markets: MarketView[]): LadderRecord[] {
  const groups = new Map<string, MarketView[]>();
  for (const m of markets.filter((m) => m.status !== "open")) {
    const key = `${m.feedId}:${m.resolveTs}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .map(([key, ms]) => {
      const settled = ms.find((m) => m.status === "resolved");
      return {
        key,
        symbol: STOCKS.find((s) => s.equityFeedId === ms[0].feedId)?.symbol ?? "?",
        resolveTs: ms[0].resolveTs,
        price: settled?.settlePrice ?? null,
        publishTime: settled?.settlePublishTime ?? null,
        yes: ms.filter((m) => m.outcome === "yes").length,
        no: ms.filter((m) => m.outcome === "no").length,
        voided: ms.filter((m) => m.status === "voided").length,
        link: explorerAddress((settled ?? ms[0]).address),
      };
    })
    .sort((a, b) => b.resolveTs - a.resolveTs);
}

function TrackRecord({ markets }: { markets: MarketView[] }) {
  const rows = ladderRecords(markets);
  if (rows.length === 0) return null;
  const strikes = rows.reduce((a, r) => a + r.yes + r.no, 0);
  const voided = rows.reduce((a, r) => a + r.voided, 0);
  return (
    <div className="mt-6 rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <span className="text-xs uppercase tracking-wider text-muted">Track record</span>
        <span className="num text-xs text-muted">
          {rows.length} ladder{rows.length > 1 ? "s" : ""} · {strikes} strikes settled by Pyth · {voided} voided
        </span>
      </div>
      <table className="num w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="px-5 py-2 font-normal">Deadline</th>
            <th className="px-3 py-2 font-normal">Pyth print</th>
            <th className="hidden px-3 py-2 font-normal sm:table-cell">Published</th>
            <th className="px-5 py-2 text-right font-normal">Strikes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line/60">
              <td className="px-5 py-2.5">
                <a href={r.link} target="_blank" rel="noreferrer" className="hover:text-bell">
                  {r.symbol} · {etTime(r.resolveTs, r.resolveTs % 60 !== 0)}
                </a>
              </td>
              <td className="px-3 py-2.5 text-bell">{r.price !== null ? usd(r.price, 2) : "none"}</td>
              <td className="hidden px-3 py-2.5 text-muted sm:table-cell">
                {r.publishTime === null
                  ? "no valid print"
                  : r.publishTime === r.resolveTs
                    ? "exactly at the deadline"
                    : `${r.publishTime - r.resolveTs}s after the deadline`}
              </td>
              <td className="px-5 py-2.5 text-right">
                {r.yes > 0 && <span className="text-yes">{r.yes} YES</span>}
                {r.yes > 0 && r.no > 0 && <span className="text-faint"> · </span>}
                {r.no > 0 && <span className="text-no">{r.no} NO</span>}
                {r.voided > 0 && <span className="text-muted"> {r.voided} refunded</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-6 max-w-3xl">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-bell">{eyebrow}</div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {sub && <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">{sub}</p>}
    </div>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-5 py-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`num mt-1 text-xl ${accent ? "text-bell" : ""}`}>{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-faint">{hint}</dd>}
    </div>
  );
}

function ago(secs: number): string {
  if (secs < 120) return `${Math.max(0, secs)}s ago`;
  return "market closed · last print";
}

/**
 * One week, Monday to Sunday, in ET: the regular session (09:30-16:00) and
 * the thin trading around it (pre-market, after-hours, overnight venues).
 * From Friday 20:00 to Sunday 20:00, 48 hours, nothing trades the stock.
 */
function WeekStrip() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // Thin trading (pre-market, after-hours, overnight) per day, in ET hours; the weekend gap is what's left.
  const thin: [number, number][] = [
    [0, 24],
    [0, 24],
    [0, 24],
    [0, 24],
    [0, 20],
    [0, 0],
    [20, 24],
  ];
  const span = ([from, to]: [number, number]) => ({
    left: `${(from / 24) * 100}%`,
    width: `${((to - from) / 24) * 100}%`,
  });
  return (
    <div className="rounded-xl border border-line bg-panel px-5 py-6 sm:px-6">
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => (
          <div key={d}>
            <div className="relative h-12 overflow-hidden rounded bg-yes-soft sm:h-14">
              <div className="absolute inset-y-0 bg-bell/25" style={span(thin[i])} />
              {i < 5 && <div className="absolute inset-y-0 bg-bell" style={span([9.5, 16])} />}
            </div>
            <div className="mt-2 text-center text-xs text-muted">{d}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-bell" /> Regular session: 32.5 hours
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-bell/25" /> Thin: pre-market, after-hours, overnight
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-yes-soft ring-1 ring-yes/40" /> Nothing trades Tesla, TSLAx keeps
          trading: 48 hours every weekend
        </span>
      </div>
    </div>
  );
}
