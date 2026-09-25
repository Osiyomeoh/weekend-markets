import { cachedMarkets, toJson } from "@/lib/server/chainReads";

export const dynamic = "force-dynamic";

/** Every operator market, shared by all visitors (see chainReads.ts). */
export async function GET() {
  try {
    const { data, stale } = await cachedMarkets();
    return new Response(toJson({ markets: data, stale }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3, stale-while-revalidate=30",
      },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
