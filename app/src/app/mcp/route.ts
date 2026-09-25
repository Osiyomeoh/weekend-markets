import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { createServer } from "../../../mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The hosted MCP endpoint: add https://weekend-markets.vercel.app/mcp to any
 * MCP client. Stateless, and it holds no keys: buying returns an unsigned
 * transaction for the caller's own wallet.
 */
async function handle(request: Request): Promise<Response> {
  const server = createServer("hosted");
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  // Browser-based clients (the MCP Inspector) need CORS; server-side clients ignore it.
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

export function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
    },
  });
}

const HELP = `Weekend Markets MCP server (Streamable HTTP, stateless, no keys).

Add it to Claude Code:
  claude mcp add --transport http weekend-markets https://weekend-markets.vercel.app/mcp
or add this URL as a custom connector in any MCP client.

Tools: gap_now, list_ladders, quote_cover, track_record, settle, cover_transaction, positions.
Docs: https://github.com/Osiyomeoh/weekend-markets#for-agents
`;

/** MCP clients ask for JSON or an event stream; a person opening the URL in a browser gets directions instead. */
export function GET(request: Request) {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/event-stream") && !accept.includes("application/json")) {
    return new Response(HELP, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return handle(request);
}

export { handle as DELETE, handle as POST };
