/**
 * Prints every operator ladder with its pools and status.
 *
 *   npx tsx scripts/status.ts
 */
import "./env";

import { Connection } from "@solana/web3.js";

import { OPERATOR, RPC_URL } from "../src/lib/config";
import { tokens } from "../src/lib/format";
import { groupSeries, impliedProbability } from "../src/lib/ladder";
import { fetchMarkets, getProgram } from "../src/lib/program";
import { stockByEquityFeed } from "../src/lib/stocks";

async function main() {
  const program = getProgram(new Connection(RPC_URL, "confirmed"));
  for (const s of groupSeries(await fetchMarkets(program, OPERATOR))) {
    const symbol = stockByEquityFeed(s.feedId)?.symbol ?? s.feedId.slice(0, 10);
    console.log(`${symbol} settles ${new Date(s.resolveTs * 1000).toISOString()} (locks ${new Date(s.lockTs * 1000).toISOString()})`);
    for (const m of s.markets) {
      const p = impliedProbability(m);
      const state = m.status === "resolved" ? `${m.outcome?.toUpperCase()} won` : m.status;
      console.log(
        `  >= $${m.strike.toFixed(2).padStart(8)}  ${state.padEnd(8)}  yes ${tokens(m.yesPool, 0).padStart(7)}  no ${tokens(m.noPool, 0).padStart(7)}  ${p === null ? "  —" : `${Math.round(p * 100)}%`.padStart(4)}  positions ${m.openPositions}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
