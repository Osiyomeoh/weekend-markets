import { Connection, PublicKey } from "@solana/web3.js";

import { OPERATOR, RPC_URL } from "../config";
import { MarketView } from "../ladder";
import { fetchMarkets, fetchPositions, getProgram, PositionView } from "../program";

/**
 * Markets and positions read once on the server and shared by every visitor.
 * The public devnet RPC rate-limits getProgramAccounts per IP, so a browser
 * polling it directly (one call per open tab every few seconds) gets 429s. A
 * short cache here, plus the CDN in front of the routes, turns that into a
 * handful of calls a minute. If a read fails, the last good result is served
 * and marked stale rather than failing the page.
 */
const SERVER_RPC_URL = process.env.DEVNET_RPC_URL || RPC_URL;
const TTL_MS = 3_000;

type Entry<T> = { at: number; data: T | null; pending: Promise<T> | null };

let connection: Connection | null = null;
const program = () => getProgram((connection ??= new Connection(SERVER_RPC_URL, "confirmed")));

async function cached<T>(entry: Entry<T>, load: () => Promise<T>): Promise<{ data: T; stale: boolean }> {
  if (entry.data !== null && Date.now() - entry.at < TTL_MS) return { data: entry.data, stale: false };
  entry.pending ??= load().finally(() => (entry.pending = null));
  try {
    const data = await entry.pending;
    entry.data = data;
    entry.at = Date.now();
    return { data, stale: false };
  } catch (e) {
    if (entry.data !== null) return { data: entry.data, stale: true };
    throw e;
  }
}

const markets: Entry<MarketView[]> = { at: 0, data: null, pending: null };
const positions = new Map<string, Entry<PositionView[]>>();

export function cachedMarkets() {
  return cached(markets, () => fetchMarkets(program(), OPERATOR));
}

export function cachedPositions(owner: PublicKey) {
  const key = owner.toBase58();
  let entry = positions.get(key);
  if (!entry) {
    if (positions.size > 1_000) positions.clear();
    positions.set(key, (entry = { at: 0, data: null, pending: null }));
  }
  return cached(entry, () => fetchPositions(program(), owner));
}

/** JSON can't carry bigints: they travel as decimal strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}
