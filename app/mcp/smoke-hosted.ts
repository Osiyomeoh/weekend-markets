/**
 * Checks the hosted MCP endpoint through the protocol, as a remote client
 * would: lists tools, reads the gap, the track record, the pre-IPO gap and the backtest, quotes cover, and
 * asks for an unsigned cover transaction for a throwaway wallet (never sent).
 *
 *   npx tsx mcp/smoke-hosted.ts                                    # production
 *   npx tsx mcp/smoke-hosted.ts http://localhost:3000/mcp
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Keypair, Transaction } from "@solana/web3.js";

const url = process.argv[2] || "https://weekend-markets.vercel.app/mcp";

async function main() {
  const client = new Client({ name: "weekend-markets-hosted-smoke", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const { tools } = await client.listTools();
  console.log(`${url}\ntools: ${tools.map((t) => t.name).join(", ")}\n`);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[]).map((c) => c.text).join("\n");
    if (r.isError) throw new Error(`${name}: ${text}`);
    console.log(`── ${name} ${JSON.stringify(args)}\n${text.length > 900 ? `${text.slice(0, 900)}…` : text}\n`);
    return text;
  };

  await call("gap_now");
  await call("track_record");
  await call("pre_ipo_gap", { stock: "OPENAI" });
  await call("cover_backtest", { shares: 10 });
  await call("quote_cover", { shares: 1 });
  const buyer = Keypair.generate().publicKey.toBase58();
  const text = await call("cover_transaction", { shares: 1, account: buyer });
  const tx = Transaction.from(Buffer.from(text.trim().split("\n").at(-1)!, "base64"));
  if (tx.feePayer?.toBase58() !== buyer) throw new Error("transaction isn't paid by the buyer");
  console.log(`decoded: ${tx.instructions.length} instructions, fee payer ${buyer}\n`);
  await call("positions", { account: buyer });

  await client.close();
  console.log("hosted smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
