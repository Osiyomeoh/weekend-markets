/**
 * Runs the agent flow end to end through the MCP protocol, the way Claude or
 * any other MCP client would: starts the server over stdio, lists its tools,
 * then funds a wallet, reads the gap, quotes and buys a little cover.
 *
 *   npx tsx mcp/smoke.ts                 # buys cover for 1 share on the furthest ladder
 *   npx tsx mcp/smoke.ts --no-buy        # read-only
 *
 * Uses its own wallet (AGENT_KEYPAIR, default in the OS temp directory), never the demo agent's.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const buy = !process.argv.includes("--no-buy");

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs"), join(__dirname, "server.ts")],
    env: {
      ...(process.env as Record<string, string>),
      AGENT_KEYPAIR: process.env.AGENT_KEYPAIR || join(tmpdir(), "weekend-markets-smoke-agent.json"),
      AGENT_MAX_SPEND: "25",
    },
    stderr: "inherit",
  });
  const client = new Client({ name: "weekend-markets-smoke", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`tools: ${tools.map((t) => t.name).join(", ")}\n`);

  const call = async (name: string, args: Record<string, unknown> = {}, expectError = false) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
    console.log(`── ${name} ${JSON.stringify(args)}${r.isError ? " (error)" : ""}\n${text}\n`);
    if (!!r.isError !== expectError) throw new Error(`${name}: expected ${expectError ? "an error" : "success"}`);
  };

  await call("wallet");
  await call("get_test_funds");
  await call("gap_now");
  await call("list_ladders");
  await call("quote_cover", { shares: 1 });
  // Guards: over the cap, and under the quoted cost, must both refuse without spending.
  await call("buy_cover", { shares: 1, max_cost: 1000 }, true);
  await call("buy_cover", { shares: 1, max_cost: 0.01 }, true);
  if (buy) await call("buy_cover", { shares: 1, max_cost: 25 });
  await call("my_cover");
  await call("settle");

  await client.close();
  console.log("smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
