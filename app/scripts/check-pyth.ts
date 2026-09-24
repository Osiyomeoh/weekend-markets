/** Smoke test for Hermes access and the settlement-timing assumption. */
import "./env";
import { latestQuotes, settlementUpdate, hermes } from "../src/lib/server/pyth";
import { STOCKS } from "../src/lib/stocks";

async function main() {
  const ids = STOCKS.flatMap((s) => [s.equityFeedId, s.xstockFeedId]);
  const q = await latestQuotes(ids);
  const now = Math.floor(Date.now() / 1000);
  for (const s of STOCKS) {
    const e = q[s.equityFeedId];
    const x = q[s.xstockFeedId];
    console.log(
      s.symbol.padEnd(5),
      "equity", e ? `${e.price.toFixed(2)} age ${now - e.publishTime}s` : "MISSING",
      "| xstock", x ? `${x.price.toFixed(2)} age ${now - x.publishTime}s` : "MISSING",
    );
  }
  // Historical: first print at/after a few recent timestamps.
  for (const back of [600, 300, 61]) {
    const t = now - back;
    try {
      const u = await settlementUpdate(STOCKS[0].equityFeedId, t, 60);
      console.log(`t-${back}s: publish ${u.quote.publishTime} (+${u.quote.publishTime - t}s) prev ${u.prevPublishTime} price ${u.quote.price.toFixed(3)} bytes ${u.data[0].length}`);
    } catch (e) {
      console.log(`t-${back}s: ${(e as Error).message}`);
    }
  }
  // Raw metadata for one timestamp, to see what Hermes returns.
  const raw = await hermes().getPriceUpdatesAtTimestamp(now - 120, [STOCKS[0].equityFeedId], { parsed: true });
  console.log(JSON.stringify(raw.parsed?.[0]?.metadata), raw.parsed?.[0]?.price.publish_time, now - 120);
}
main().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
