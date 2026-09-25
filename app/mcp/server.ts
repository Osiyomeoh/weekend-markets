/**
 * Weekend Markets as an MCP server: tools for an AI agent to read the gap, and
 * to quote, buy, follow, settle and claim gap cover on Solana devnet.
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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as agent from "./agent";

const INSTRUCTIONS = `Weekend Markets sells gap cover for tokenized stocks (TSLAx, TSLAon) on Solana devnet.
Cover pays if the stock's next opening print is below chosen levels, and settles on-chain from the first Pyth price
at or after the deadline. It never pays more than the position loses, so it is a hedge, not a bet.
All money is test USDC (tUSDC) on devnet.

Typical flow: wallet, then get_test_funds the first time. gap_now shows how far the token has drifted from the
stock's last price. quote_cover prices protection; show the user the cost and what it pays before buying.
buy_cover spends from the agent's wallet, up to the spending cap. my_cover follows positions. After the deadline,
settle (anyone can) and then claim.`;

const read = { readOnlyHint: true, openWorldHint: true } as const;

const stock = z.string().optional().describe("Ticker or token symbol, e.g. TSLA, TSLAx or TSLAon. Default TSLA.");
const coverArgs = {
  stock,
  shares: z.number().positive().optional().describe("How many shares to cover. Omit when passing holder."),
  holder: z
    .string()
    .optional()
    .describe("A Solana mainnet wallet. Cover is sized to the TSLAx and TSLAon it holds (read-only lookup)."),
  until: z
    .string()
    .optional()
    .describe("Which ladder: its deadline as ISO time or unix seconds, from list_ladders. Default: the furthest one."),
  starts_below: z
    .number()
    .optional()
    .describe(
      "Strike where cover starts paying (sets the deductible). Default: the first strike 1% or more below the price.",
    ),
  down_to: z.number().optional().describe("Lowest strike covered. Default: the lowest strike on the ladder."),
};

const server = new McpServer({ name: "weekend-markets", version: "0.1.0" }, { instructions: INSTRUCTIONS });

/** Tool results are plain text for the model; failures come back as tool errors, not crashes. */
async function respond(fn: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await fn() }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
}

server.registerTool(
  "wallet",
  {
    title: "Agent wallet",
    description:
      "The agent's devnet wallet: address, tUSDC and SOL balance, and its spending cap. Creates it on first use.",
    inputSchema: {},
    annotations: { openWorldHint: true },
  },
  () => respond(() => agent.wallet()),
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
  () => respond(() => agent.getTestFunds()),
);

server.registerTool(
  "gap_now",
  {
    title: "The gap right now",
    description:
      "The stock's latest Pyth price, whether Wall Street is open, and where its tokens trade on Solana right now. When the market is closed, the difference is the gap the next opening print is likely to deliver.",
    inputSchema: { stock },
    annotations: read,
  },
  ({ stock }) => respond(() => agent.gapNow(stock)),
);

server.registerTool(
  "list_ladders",
  {
    title: "Open ladders",
    description:
      "Strike ladders taking stakes: deadline, when stakes close, and YES/NO odds per strike. Each ladder settles on the first Pyth print at or after its deadline.",
    inputSchema: { stock },
    annotations: read,
  },
  ({ stock }) => respond(() => agent.ladders(stock)),
);

server.registerTool(
  "quote_cover",
  {
    title: "Quote gap cover",
    description:
      "Prices cover for a stock position until a ladder's deadline: the cost, the most it pays, and what it pays if the stock opens below each strike. Spends nothing.",
    inputSchema: coverArgs,
    annotations: read,
  },
  (args) => respond(() => agent.quoteCover(args)),
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
  (args) => respond(() => agent.buyCover(args)),
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
  () => respond(() => agent.myCover()),
);

server.registerTool(
  "settle",
  {
    title: "Settle due ladders",
    description:
      "Settles every ladder whose deadline has passed, using the first Pyth print at or after it. Permissionless: the program checks the price itself.",
    inputSchema: {},
    annotations: { idempotentHint: true, openWorldHint: true },
  },
  () => respond(() => agent.settle()),
);

server.registerTool(
  "claim",
  {
    title: "Claim payouts",
    description: "Claims every settled position in the agent's wallet: winnings, and refunds from voided strikes.",
    inputSchema: {},
    annotations: { idempotentHint: true, openWorldHint: true },
  },
  () => respond(() => agent.claim()),
);

server.connect(new StdioServerTransport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
