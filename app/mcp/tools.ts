/**
 * The Weekend Markets MCP tools shared by two servers:
 *
 *   - local (mcp/server.ts, stdio): adds the agent's own devnet wallet, so it
 *     can buy, follow and claim itself, under a spending cap (wallet.ts);
 *   - hosted (app route /mcp, HTTP): holds no keys. Anyone can add it by URL to
 *     read the gap, quote cover, and get an unsigned transaction for their own
 *     wallet to sign.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import * as agent from "./agent";

const ABOUT = `Weekend Markets sells gap cover for tokenized stocks (TSLAx, TSLAon) on Solana devnet.
Cover pays if the stock's next opening print is below chosen levels, and settles on-chain from the first Pyth price
at or after the deadline. It never pays more than the position loses, so it is a hedge, not a bet.
All money is test USDC (tUSDC) on devnet.`;

const LOCAL = `${ABOUT}

Typical flow: wallet, then get_test_funds the first time. gap_now shows how far the token has drifted from the
stock's last price. quote_cover prices protection; show the user the cost and what it pays before buying.
buy_cover spends from the agent's wallet, up to the spending cap. my_cover follows positions. After the deadline,
settle (anyone can) and then claim. track_record shows how every past ladder settled.`;

const HOSTED = `${ABOUT}

This hosted server holds no keys and spends nothing. gap_now shows how far the token has drifted from the stock's
last price; quote_cover prices protection; track_record shows how every past ladder settled on Pyth. To buy, call
cover_transaction with the buyer's wallet address: it returns an unsigned transaction to sign with that wallet.
positions follows any wallet. An agent that should hold its own wallet and buy and claim by itself can run the local
server from https://github.com/Osiyomeoh/weekend-markets (app/mcp).`;

export const read = { readOnlyHint: true, openWorldHint: true } as const;

const stock = z.string().optional().describe("Ticker or token symbol, e.g. TSLA, TSLAx or TSLAon. Default TSLA.");
export const coverArgs = {
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

/** Tool results are plain text for the model; failures come back as tool errors, not crashes. */
export async function respond(fn: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await fn() }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
}

export function createServer(kind: "local" | "hosted"): McpServer {
  const server = new McpServer(
    { name: "weekend-markets", version: "0.2.0" },
    { instructions: kind === "local" ? LOCAL : HOSTED },
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
    (args) => respond(() => agent.quoteCover(args, kind === "local" ? "buy_cover" : "cover_transaction")),
  );

  server.registerTool(
    "track_record",
    {
      title: "Track record",
      description:
        "Every finished ladder: its deadline, the Pyth print that settled it and when that print was published, and which strikes paid YES or NO.",
      inputSchema: {},
      annotations: read,
    },
    () => respond(() => agent.trackRecord()),
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

  if (kind === "hosted") {
    server.registerTool(
      "cover_transaction",
      {
        title: "Cover as a transaction",
        description:
          "Builds the cover quote_cover describes as an unsigned Solana devnet transaction for `account` to sign and send. Nothing is spent until that wallet signs. Quote first and get the user's agreement to the cost.",
        inputSchema: {
          ...coverArgs,
          account: z.string().describe("The buyer's wallet address: it signs and pays the transaction fee."),
        },
        annotations: read,
      },
      (args) => respond(() => agent.coverTransaction(args)),
    );

    server.registerTool(
      "positions",
      {
        title: "Positions",
        description:
          "Any wallet's Weekend Markets positions on devnet: what each pays and when it settles, which are settled, and what is ready to claim.",
        inputSchema: { account: z.string().describe("The wallet address to look up.") },
        annotations: read,
      },
      ({ account }) =>
        respond(() =>
          agent.positionsOf(agent.walletAddress(account), {
            claimHint: "Claim them at https://weekend-markets.vercel.app/portfolio.",
          }),
        ),
    );
  }
  return server;
}
