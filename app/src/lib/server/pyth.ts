import { HermesClient } from "@pythnetwork/hermes-client";

import { normalizeFeedId } from "../stocks";

/** Upgraded Hermes endpoint (Pyth Core upgrade, 2026-08-26). Requires an API key. */
export const HERMES_URL = process.env.PYTH_HERMES_URL || "https://pyth.dourolabs.app/hermes";

export function hermes(): HermesClient {
  const accessToken = process.env.PYTH_API_KEY;
  if (!accessToken) throw new Error("PYTH_API_KEY is not set");
  return new HermesClient(HERMES_URL, { accessToken, timeout: 10_000 });
}

export type Quote = {
  feedId: string;
  price: number;
  conf: number;
  publishTime: number;
};

type ParsedUpdate = {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
  metadata?: { prev_publish_time?: number; slot?: number };
};

function toQuote(p: ParsedUpdate): Quote {
  const scale = 10 ** p.price.expo;
  return {
    feedId: normalizeFeedId(p.id),
    price: Number(p.price.price) * scale,
    conf: Number(p.price.conf) * scale,
    publishTime: p.price.publish_time,
  };
}

/**
 * Latest price per feed. Fetched one feed per request because Hermes rejects
 * the whole batch (403) if the API key isn't entitled to any one feed; feeds
 * we can't read are simply absent from the result.
 */
export async function latestQuotes(feedIds: string[]): Promise<Record<string, Quote>> {
  const client = hermes();
  const results = await Promise.allSettled(
    feedIds.map((id) => client.getLatestPriceUpdates([id], { parsed: true })),
  );
  const out: Record<string, Quote> = {};
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const p of (r.value.parsed ?? []) as ParsedUpdate[]) {
      const q = toQuote(p);
      out[q.feedId] = q;
    }
  }
  return out;
}

export type SettlementUpdate = {
  /** Base64 accumulator update data, ready for the Pyth receiver. */
  data: string[];
  quote: Quote;
  prevPublishTime: number;
};

export class NotYetPublished extends Error {}
export class NoPrintInWindow extends Error {}

/**
 * The signed update the program will accept for a market: the first print at
 * or after `resolveTs`. Mirrors `math::check_settlement_timing` so we never
 * pay to post an update the program would reject.
 */
export async function settlementUpdate(
  feedId: string,
  resolveTs: number,
  windowSecs: number,
): Promise<SettlementUpdate> {
  const res = await hermes().getPriceUpdatesAtTimestamp(resolveTs, [feedId], {
    parsed: true,
    encoding: "base64",
  });
  const parsed = (res.parsed ?? [])[0] as ParsedUpdate | undefined;
  if (!parsed) throw new NotYetPublished(`no update for ${feedId} at ${resolveTs} yet`);

  const publishTime = parsed.price.publish_time;
  const prev = parsed.metadata?.prev_publish_time;
  if (publishTime < resolveTs) throw new NotYetPublished(`latest print ${publishTime} is before ${resolveTs}`);
  if (publishTime > resolveTs + windowSecs) {
    throw new NoPrintInWindow(`first print ${publishTime} is after the ${windowSecs}s window`);
  }
  if (prev === undefined || prev >= resolveTs) {
    throw new Error(`Hermes returned a print whose predecessor (${prev}) is not before ${resolveTs}`);
  }
  return { data: res.binary.data, quote: toQuote(parsed), prevPublishTime: prev };
}
