/**
 * Solana Actions discovery: a link to the Cover page unfurls as the cover
 * Blink in wallets and clients that support Actions.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    {
      rules: [
        { pathPattern: "/cover", apiPath: "/api/actions/cover" },
        { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      ],
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS" } },
  );
}
