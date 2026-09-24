/**
 * Keeper: settles every operator market that is due. Resolves against the
 * first Pyth print at or after resolve_ts, or voids one-sided markets.
 *
 *   npx tsx scripts/settle-due.ts            # one pass
 *   npx tsx scripts/settle-due.ts --watch    # poll every 15s
 */
import "./env";

import { Connection, PublicKey } from "@solana/web3.js";
import { parseArgs } from "node:util";

import { explorerTx, OPERATOR, RPC_URL } from "../src/lib/config";
import { fetchMarkets, getProgram } from "../src/lib/program";
import { settleMarket } from "../src/lib/server/keeper";
import { loadOperator } from "../src/lib/server/operator";
import { NotYetPublished } from "../src/lib/server/pyth";
import { stockByEquityFeed } from "../src/lib/stocks";
import { keypairWallet } from "../src/lib/server/keypairWallet";

const { values: args } = parseArgs({ options: { watch: { type: "boolean", default: false } } });

async function pass(connection: Connection) {
  const operator = loadOperator();
  const program = getProgram(connection, keypairWallet(operator));
  const now = Date.now() / 1000;
  const due = (await fetchMarkets(program, OPERATOR)).filter(
    (m) =>
      m.status === "open" &&
      (now >= m.resolveTs || (now >= m.lockTs && (m.yesPool === 0n || m.noPool === 0n))),
  );
  if (due.length === 0) console.log(new Date().toISOString(), "nothing due");
  for (const m of due) {
    const label = `${stockByEquityFeed(m.feedId)?.symbol ?? m.feedId.slice(0, 10)} >= $${m.strike.toFixed(2)}`;
    try {
      const r = await settleMarket(connection, operator, new PublicKey(m.address));
      const detail =
        r.action === "resolved"
          ? `${r.market.outcome?.toUpperCase()} at $${r.market.settlePrice?.toFixed(4)} (published ${r.market.settlePublishTime})`
          : `voided (${r.market.voidReason})`;
      console.log(`${label}: ${detail}`, explorerTx(r.signatures.at(-1)!));
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`${label}: ${e instanceof NotYetPublished ? "waiting for Pyth" : "failed"}: ${msg}`);
    }
  }
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  do {
    await pass(connection);
    if (args.watch) await new Promise((r) => setTimeout(r, 15_000));
  } while (args.watch);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
