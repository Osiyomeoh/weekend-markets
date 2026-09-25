import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { groupSeries } from "../ladder";
import { fetchMarkets, getProgram } from "../program";
import { nextOpeningBell } from "../sessions";
import { STOCKS } from "../stocks";
import { settleLadder } from "./keeper";
import { keypairWallet } from "./keypairWallet";
import { loadOperator } from "./operator";
import { pythHolidays } from "./marketHours";
import { latestQuotes } from "./pyth";
import { createLadder, DEFAULT_LADDER, ladderExists } from "./series";

/** Stop starting new work after this, so the function never hits its time limit mid-transaction. */
const BUDGET_MS = 40_000;
/** Open the next ladder once its betting would close at least this far ahead. */
const LEAD_SECS = 20 * 60;
/** Don't create ladders if the operator can't also afford to settle them. */
const MIN_OPERATOR_SOL = 0.3;
/** Don't center a ladder on a price older than this (a broken or paused feed). */
const MAX_QUOTE_AGE_SECS = 4 * 86_400;

export type TickReport = {
  settled: { resolved: number; voided: number; signatures: string[] }[];
  pending: { market: string; reason: string }[];
  created: { stock: string; resolveTs: number; strikes: number[] }[];
  notes: string[];
  operatorSol: number;
};

/**
 * One keeper pass, safe to repeat or overlap:
 *   1. settles every ladder that is due, one posted Pyth update per ladder;
 *   2. opens the ladder for the next opening bell for every stock we can price.
 */
export async function runTick(
  connection: Connection,
  steps: { settle: boolean; create: boolean } = { settle: true, create: true },
): Promise<TickReport> {
  const started = Date.now();
  const ctx: Ctx = {
    connection,
    operator: loadOperator(),
    outOfTime: () => Date.now() - started > BUDGET_MS,
    report: { settled: [], pending: [], created: [], notes: [], operatorSol: 0 },
  };
  if (steps.settle) await settleDue(ctx);
  if (steps.create) await openNextLadders(ctx);
  return ctx.report;
}

type Ctx = { connection: Connection; operator: Keypair; outOfTime: () => boolean; report: TickReport };

async function settleDue({ connection, operator, outOfTime, report }: Ctx) {
  const program = getProgram(connection, keypairWallet(operator));
  const now = Date.now() / 1000;
  const due = (await fetchMarkets(program, operator.publicKey)).filter(
    (m) => m.status === "open" && (now >= m.resolveTs || (now >= m.lockTs && (m.yesPool === 0n || m.noPool === 0n))),
  );
  for (const ladder of groupSeries(due)) {
    if (outOfTime()) {
      report.notes.push("out of time before settling everything; the next tick continues");
      return;
    }
    try {
      const r = await settleLadder(
        connection,
        operator,
        ladder.markets.map((m) => new PublicKey(m.address)),
      );
      report.settled.push({ resolved: r.resolved.length, voided: r.voided.length, signatures: r.signatures });
      report.pending.push(...r.pending);
    } catch (e) {
      report.notes.push(`settle ${ladder.resolveTs}: ${(e as Error).message}`);
    }
  }
}

async function openNextLadders({ connection, operator, outOfTime, report }: Ctx) {
  report.operatorSol = (await connection.getBalance(operator.publicKey)) / LAMPORTS_PER_SOL;
  if (report.operatorSol < MIN_OPERATOR_SOL) {
    report.notes.push(`operator has ${report.operatorSol} SOL; not opening new ladders until it's topped up`);
    return;
  }
  const quotes = await latestQuotes(STOCKS.map((s) => s.equityFeedId));
  for (const stock of STOCKS) {
    const quote = quotes[stock.equityFeedId];
    if (!quote) continue; // our Pyth key isn't entitled to this feed
    if (Date.now() / 1000 - quote.publishTime > MAX_QUOTE_AGE_SECS) {
      report.notes.push(`${stock.symbol}: last Pyth print is too old to center a ladder on`);
      continue;
    }
    // Skip exchange holidays: a ladder on a closed day gets no print and refunds everyone.
    const holidays = await pythHolidays(stock).catch((e: Error) => {
      report.notes.push(`${stock.symbol}: ${e.message}; assuming every weekday opens`);
      return new Set<string>();
    });
    const resolveTs = nextOpeningBell(Date.now() / 1000, LEAD_SECS, DEFAULT_LADDER.lockBeforeSecs, holidays);
    if (await ladderExists(connection, operator, stock, resolveTs)) continue;
    if (outOfTime()) {
      report.notes.push(`${stock.symbol}: out of time; the next tick opens it`);
      return;
    }
    try {
      const r = await createLadder(connection, operator, { stock, resolveTs, ...DEFAULT_LADDER }, quote.price);
      report.created.push({ stock: stock.symbol, resolveTs, strikes: r.created.map((c) => c.strike) });
    } catch (e) {
      report.notes.push(`${stock.symbol} ladder: ${(e as Error).message}`);
    }
  }
}
