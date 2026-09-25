/**
 * Weekend Markets as a local MCP server: tools for an AI agent with its own
 * devnet wallet to read the gap, and to quote, buy, follow, settle and claim
 * gap cover. The hosted endpoint (/mcp) serves the same market tools without
 * a wallet; see tools.ts.
 *
 *   npx tsx mcp/server.ts
 *
 * Claude Code:
 *   claude mcp add weekend-markets -e AGENT_MAX_SPEND=100 -- npx tsx <repo>/app/mcp/server.ts
 *
 * Environment (all optional):
 *   AGENT_KEYPAIR        the agent's devnet wallet; created on first use (default keys/agent.json)
 *   AGENT_MAX_SPEND      most one purchase may cost, in tUSDC (default 100)
 *   WEEKEND_MARKETS_URL  the app whose public routes serve prices, holdings, faucet and settlement
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { coverArgs, createServer, read, respond } from "./tools";
import * as wallet from "./wallet";

const server = createServer("local");

server.registerTool(
  "wallet",
  {
    title: "Agent wallet",
    description:
      "The agent's devnet wallet: address, tUSDC and SOL balance, and its spending cap. Creates it on first use.",
    inputSchema: {},
    annotations: { openWorldHint: true },
  },
  () => respond(() => wallet.wallet()),
);

server.registerTool(
  "get_test_funds",
  {
    title: "Get test funds",
    description:
      "Sends the agent's wallet test USDC and a little devnet SOL from the Weekend Markets faucet. Once per wallet.",
    inputSchema: {},
    annotations: { openWorldHint: true },
  },
  () => respond(() => wallet.getTestFunds()),
);

server.registerTool(
  "buy_cover",
  {
    title: "Buy gap cover",
    description:
      "Buys the cover quote_cover describes, in one transaction from the agent's wallet. Fails without spending if the cost is above max_cost or the agent's spending cap. Quote first and get the user's agreement to the cost.",
    inputSchema: {
      ...coverArgs,
      max_cost: z.number().positive().describe("Most to pay, in tUSDC. The purchase fails if cover costs more."),
    },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  (args) => respond(() => wallet.buyCover(args)),
);

server.registerTool(
  "my_cover",
  {
    title: "My cover",
    description:
      "The agent's positions: what each pays and when it settles, which are settled, and what is ready to claim.",
    inputSchema: {},
    annotations: read,
  },
  () => respond(() => wallet.myCover()),
);

server.registerTool(
  "claim",
  {
    title: "Claim payouts",
    description: "Claims every settled position in the agent's wallet: winnings, and refunds from voided strikes.",
    inputSchema: {},
    annotations: { idempotentHint: true, openWorldHint: true },
  },
  () => respond(() => wallet.claim()),
);

server.connect(new StdioServerTransport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
