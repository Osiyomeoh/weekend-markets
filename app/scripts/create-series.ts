/**
 * Creates a strike ladder (one binary market per strike) for each stock,
 * all settling on the first Pyth print at or after the same time, and seeds
 * each market with opening odds from a simple lognormal model so the ladder
 * isn't empty. The seed stakes are ordinary bets from the operator wallet.
 *
 *   npx tsx scripts/create-series.ts --resolve monday-open --stocks NVDA,TSLA
 *   npx tsx scripts/create-series.ts --resolve-in 20 --lock-before 2 --stocks TSLA
 *
 * Options:
 *   --resolve <ISO time | monday-open>   settlement time (monday-open = next Mon 09:30 ET)
 *   --resolve-in <minutes>               alternative: settle N minutes from now
 *   --lock-before <minutes>              stop betting N minutes before settlement (default 5)
 *   --stocks <A,B>                       default: all stocks with a readable Pyth price
 *   --strikes <n>                        strikes per ladder, odd (default 5)
 *   --seed <tUSDC>                       seed stake per market (default 100)
 *   --window <seconds>                   settlement window (default 120)
 */
import "./env";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Transaction } from "@solana/web3.js";
import { parseArgs } from "node:util";

import { COLLATERAL_DECIMALS, COLLATERAL_MINT, explorerAddress, RPC_URL } from "../src/lib/config";
import { modelProbabilityAbove, strikeToOnChain } from "../src/lib/ladder";
import { createMarketIx, getProgram, placeBetIxs } from "../src/lib/program";
import { loadOperator } from "../src/lib/server/operator";
import { latestQuotes } from "../src/lib/server/pyth";
import { STOCKS } from "../src/lib/stocks";
import { keypairWallet } from "../src/lib/server/keypairWallet";

const { values: args } = parseArgs({
  options: {
    resolve: { type: "string" },
    "resolve-in": { type: "string" },
    "lock-before": { type: "string", default: "5" },
    stocks: { type: "string" },
    strikes: { type: "string", default: "5" },
    seed: { type: "string", default: "100" },
    window: { type: "string", default: "120" },
  },
});

/** Next Monday 09:30 America/New_York, as unix seconds. */
function nextMondayOpen(now = new Date()): number {
  for (let d = 0; d < 8; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZoneName: "shortOffset",
      })
        .formatToParts(day)
        .map((p) => [p.type, p.value]),
    );
    if (parts.weekday !== "Mon") continue;
    const offset = parts.timeZoneName.replace("GMT", "") || "+0"; // e.g. -4
    const sign = offset.startsWith("-") ? "-" : "+";
    const hours = offset.replace(/[+-]/, "").padStart(2, "0");
    const ts = Date.parse(`${parts.year}-${parts.month}-${parts.day}T09:30:00${sign}${hours}:00`) / 1000;
    if (ts > now.getTime() / 1000 + 600) return ts;
  }
  throw new Error("could not find next Monday");
}

function resolveTime(): number {
  if (args["resolve-in"]) return Math.floor(Date.now() / 1000) + Math.round(Number(args["resolve-in"]) * 60);
  if (!args.resolve || args.resolve === "monday-open") return nextMondayOpen();
  const ts = Date.parse(args.resolve) / 1000;
  if (!Number.isFinite(ts)) throw new Error(`bad --resolve ${args.resolve}`);
  return Math.floor(ts);
}

function roundToTick(x: number, tick: number): number {
  return Math.round(x / tick) * tick;
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const operator = loadOperator();
  const program = getProgram(connection, keypairWallet(operator));

  const resolveTs = resolveTime();
  const lockTs = resolveTs - Math.round(Number(args["lock-before"]) * 60);
  const nStrikes = Number(args.strikes);
  const seed = BigInt(Math.round(Number(args.seed) * 10 ** COLLATERAL_DECIMALS));
  if (lockTs <= Date.now() / 1000 + 30) throw new Error("lock time must be at least 30s in the future");
  if (nStrikes < 1 || nStrikes % 2 === 0) throw new Error("--strikes must be odd");

  const wanted = args.stocks ? args.stocks.split(",").map((s) => s.trim().toUpperCase()) : null;
  const candidates = STOCKS.filter((s) => !wanted || wanted.includes(s.symbol));
  const quotes = await latestQuotes(candidates.map((s) => s.equityFeedId));

  // The operator is the test-USDC mint authority: mint exactly what seeding needs.
  const operatorToken = getAssociatedTokenAddressSync(COLLATERAL_MINT, operator.publicKey);
  const needed = seed * BigInt(nStrikes * candidates.length);
  const have = await connection
    .getTokenAccountBalance(operatorToken)
    .then((b) => BigInt(b.value.amount))
    .catch(() => 0n);
  if (have < needed) {
    await program.provider.sendAndConfirm!(
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, operatorToken, operator.publicKey, COLLATERAL_MINT),
        createMintToInstruction(COLLATERAL_MINT, operatorToken, operator.publicKey, needed - have),
      ),
      [operator],
    );
  }

  const years = (resolveTs - Date.now() / 1000) / (365 * 86_400);
  console.log(`settles ${new Date(resolveTs * 1000).toISOString()}, betting closes ${new Date(lockTs * 1000).toISOString()}`);

  for (const [stockIndex, stock] of STOCKS.entries()) {
    if (!candidates.includes(stock)) continue;
    const quote = quotes[stock.equityFeedId];
    if (!quote) {
      console.log(`${stock.symbol}: no readable Pyth price for ${stock.equityFeedId}, skipped`);
      continue;
    }
    const spot = quote.price;
    // Space strikes about 0.6 standard deviations apart over the horizon.
    const sd = spot * stock.annualVol * Math.sqrt(years);
    const step = Math.max(stock.tick, roundToTick(sd * 0.6, stock.tick));
    const center = roundToTick(spot, stock.tick);
    const half = (nStrikes - 1) / 2;
    console.log(`${stock.symbol}: spot ${spot.toFixed(2)}, strikes every $${step}`);

    for (let k = -half; k <= half; k++) {
      const strike = center + k * step;
      const { price, expo } = strikeToOnChain(strike);
      const marketId = BigInt(resolveTs) * 1000n + BigInt(stockIndex * 100 + (k + half));
      const { market, ix } = await createMarketIx(program, {
        creator: operator.publicKey,
        marketId,
        feedId: stock.equityFeedId,
        strikePrice: price,
        strikeExpo: expo,
        lockTs,
        resolveTs,
        resolveWindowSecs: Number(args.window),
        voidDelaySecs: 3_600,
        maxConfBps: 100,
      });
      if (await connection.getAccountInfo(market)) {
        console.log(`  $${strike} exists ${market.toBase58()}`);
        continue;
      }

      const p = Math.min(0.95, Math.max(0.05, modelProbabilityAbove(spot, strike, stock.annualVol, years)));
      const yes = BigInt(Math.max(1, Math.round(Number(seed) * p)));
      const no = BigInt(Math.max(1, Number(seed) - Number(yes)));
      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
        ix,
        ...(await placeBetIxs(program, { market, bettor: operator.publicKey, side: "yes", amount: yes })),
        ...(await placeBetIxs(program, { market, bettor: operator.publicKey, side: "no", amount: no })),
      );
      const sig = await program.provider.sendAndConfirm!(tx, [operator]);
      console.log(`  $${strike.toFixed(2)} p=${p.toFixed(2)} ${explorerAddress(market.toBase58())} ${sig.slice(0, 12)}…`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

