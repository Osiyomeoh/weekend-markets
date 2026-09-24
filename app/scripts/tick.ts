/**
 * Runs one keeper pass locally, the same one the scheduled job runs in the app.
 *
 *   npx tsx scripts/tick.ts              # settle what's due, open the next ladders
 *   npx tsx scripts/tick.ts --no-settle  # only open ladders
 *   npx tsx scripts/tick.ts --no-create  # only settle
 *   npx tsx scripts/tick.ts --watch      # repeat every minute (a local keeper)
 */
import "./env";

import { Connection } from "@solana/web3.js";
import { parseArgs } from "node:util";

import { RPC_URL } from "../src/lib/config";
import { runTick } from "../src/lib/server/tick";

const { values: args } = parseArgs({
  options: {
    "no-settle": { type: "boolean", default: false },
    "no-create": { type: "boolean", default: false },
    watch: { type: "boolean", default: false },
  },
});

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const steps = { settle: !args["no-settle"], create: !args["no-create"] };
  do {
    const r = await runTick(connection, steps);
    console.log(new Date().toISOString(), JSON.stringify(r));
    if (args.watch) await new Promise((resolve) => setTimeout(resolve, 60_000));
  } while (args.watch);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
