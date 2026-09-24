/**
 * Opens a strike ladder (one binary market per strike) for each stock, all
 * settling on the first Pyth print at or after the same time, seeded at
 * lognormal model odds. The scheduled keeper does this automatically for every
 * opening bell; this script is for one-off ladders.
 *
 *   npx tsx scripts/create-series.ts                      # next opening bell
 *   npx tsx scripts/create-series.ts --resolve-in 20 --lock-before 2
 *
 * Options:
 *   --resolve <ISO time | next-open>   settlement time (default next-open: next weekday 09:30 ET)
 *   --resolve-in <minutes>             alternative: settle N minutes from now
 *   --lock-before <minutes>            stop betting N minutes before settlement (default 5)
 *   --stocks <A,B>                     default: every stock with a readable Pyth price
 *   --strikes <n>                      strikes per ladder, odd (default 5)
 *   --seed <tUSDC>                     seed stake per market (default 5000)
 *   --window <seconds>                 settlement window (default 120)
 */
import "./env";

import { Connection } from "@solana/web3.js";
import { parseArgs } from "node:util";

import { explorerAddress, RPC_URL } from "../src/lib/config";
import { loadOperator } from "../src/lib/server/operator";
import { latestQuotes } from "../src/lib/server/pyth";
import { createLadder, DEFAULT_LADDER } from "../src/lib/server/series";
import { nextOpeningBell } from "../src/lib/sessions";
import { STOCKS } from "../src/lib/stocks";

const { values: args } = parseArgs({
  options: {
    resolve: { type: "string", default: "next-open" },
    "resolve-in": { type: "string" },
    "lock-before": { type: "string", default: String(DEFAULT_LADDER.lockBeforeSecs / 60) },
    stocks: { type: "string" },
    strikes: { type: "string", default: String(DEFAULT_LADDER.strikes) },
    seed: { type: "string", default: String(DEFAULT_LADDER.seed) },
    window: { type: "string", default: String(DEFAULT_LADDER.windowSecs) },
  },
});

async function main() {
  const now = Date.now() / 1000;
  const lockBeforeSecs = Math.round(Number(args["lock-before"]) * 60);
  let resolveTs: number;
  if (args["resolve-in"]) resolveTs = Math.floor(now) + Math.round(Number(args["resolve-in"]) * 60);
  else if (args.resolve === "next-open") resolveTs = nextOpeningBell(now, 600, lockBeforeSecs);
  else resolveTs = Math.floor(Date.parse(args.resolve!) / 1000);
  if (!Number.isFinite(resolveTs)) throw new Error(`bad --resolve ${args.resolve}`);

  const connection = new Connection(RPC_URL, "confirmed");
  const operator = loadOperator();
  const wanted = args.stocks?.split(",").map((s) => s.trim().toUpperCase());
  const stocks = STOCKS.filter((s) => !wanted || wanted.includes(s.symbol));
  const quotes = await latestQuotes(stocks.map((s) => s.equityFeedId));
  console.log(`settles ${new Date(resolveTs * 1000).toISOString()}, betting closes ${lockBeforeSecs / 60} min before`);

  for (const stock of stocks) {
    const quote = quotes[stock.equityFeedId];
    if (!quote) {
      console.log(`${stock.symbol}: no readable Pyth price, skipped`);
      continue;
    }
    const r = await createLadder(
      connection,
      operator,
      {
        ...DEFAULT_LADDER,
        stock,
        resolveTs,
        lockBeforeSecs,
        strikes: Number(args.strikes),
        seed: Number(args.seed),
        windowSecs: Number(args.window),
      },
      quote.price,
    );
    console.log(`${stock.symbol} at ${quote.price.toFixed(2)}: created ${r.created.length}, already existed ${r.skipped}`);
    for (const c of r.created) console.log(`  $${c.strike.toFixed(2)} ${explorerAddress(c.market)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
