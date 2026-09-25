/**
 * What an AI agent can do with Weekend Markets without a wallet: read the gap
 * and the ladders, quote cover for a position, build the purchase as an
 * unsigned transaction, follow any wallet, read the track record, settle.
 * Shared by the local MCP server (which adds its own wallet, see wallet.ts) and
 * the hosted endpoint (which holds no keys).
 *
 * Prices, mainnet holdings, the faucet and settlement go through the app's
 * public routes, so the agent needs no API keys and never sees the operator's.
 * Everything else is read from the chain directly.
 */
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

import {
  COLLATERAL_DECIMALS,
  COLLATERAL_MINT,
  COLLATERAL_SYMBOL,
  explorerTx,
  OPERATOR,
  RPC_URL,
} from "../src/lib/config";
import { coverPlan, CoverPlan, defaultCoverRange } from "../src/lib/cover";
import { countdown, etTime, pct, tokens, usd } from "../src/lib/format";
import {
  currentPayout,
  groupSeries,
  impliedMedian,
  impliedProbability,
  MarketView,
  positionPayout,
  Series,
  seriesCurve,
} from "../src/lib/ladder";
import { fetchMarkets, fetchPositions, getProgram, placeBetIxs } from "../src/lib/program";
import { pythHolidays } from "../src/lib/server/marketHours";
import { nextOpeningBell, usSession } from "../src/lib/sessions";
import { Stock, STOCKS } from "../src/lib/stocks";

export const APP_URL = (process.env.WEEKEND_MARKETS_URL || "https://weekend-markets.vercel.app").replace(/\/$/, "");

export const UNIT = 10 ** COLLATERAL_DECIMALS;
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const UNPRICED = "this deployment only prices stocks its Pyth key is entitled to (TSLA today)";

type Quote = { feedId: string; price: number; conf: number; publishTime: number };
type TokenPrice = { mint: string; price: number };
type Holding = { stock: string; symbol: string; shares: number };

const now = () => Math.floor(Date.now() / 1000);
export const money = (raw: bigint) => `${tokens(raw)} ${COLLATERAL_SYMBOL}`;

// ---------------------------------------------------------------- plumbing

let conn: Connection | null = null;

/** Devnet only: the agent spends test money, and refuses to sign anywhere else. */
export async function connection(): Promise<Connection> {
  if (conn) return conn;
  const c = new Connection(RPC_URL, "confirmed");
  if ((await c.getGenesisHash()) !== DEVNET_GENESIS) {
    throw new Error(`${RPC_URL} is not Solana devnet. This agent only works with test money on devnet.`);
  }
  return (conn = c);
}

async function api<T>(path: string, body?: unknown): Promise<{ status: number; body: T & { error?: string } }> {
  const res = await fetch(`${APP_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({ error: `${path} returned ${res.status}` })) };
}

export async function apiOk<T>(path: string, body?: unknown): Promise<T> {
  const r = await api<T>(path, body);
  if (r.status >= 400) throw new Error(r.body.error ?? `${path} returned ${r.status}`);
  return r.body;
}

function findStock(symbol = "TSLA"): Stock {
  const s = symbol.trim().toUpperCase();
  const stock = STOCKS.find((x) => x.symbol === s || x.tokenized.some((t) => t.symbol.toUpperCase() === s));
  if (!stock) throw new Error(`Unknown stock ${symbol}. Known: ${STOCKS.map((x) => x.symbol).join(", ")}.`);
  return stock;
}

async function quotes(): Promise<Record<string, Quote>> {
  return (await apiOk<{ quotes: Record<string, Quote> }>("/api/prices")).quotes;
}

async function spotOf(stock: Stock): Promise<Quote> {
  const q = (await quotes())[stock.equityFeedId];
  if (!q) throw new Error(`No Pyth price for ${stock.symbol}: ${UNPRICED}.`);
  return q;
}

// Listing every market is the public RPC's most rate-limited call, and one agent turn often makes several tool
// calls in a row: share a recent result, and any request already in flight.
let marketsCache: { at: number; markets: Promise<MarketView[]> } | null = null;
const MARKETS_TTL_MS = 5_000;

export async function allMarkets(fresh = false): Promise<MarketView[]> {
  if (fresh || !marketsCache || Date.now() - marketsCache.at > MARKETS_TTL_MS) {
    const markets = connection().then((c) => fetchMarkets(getProgram(c), OPERATOR));
    marketsCache = { at: Date.now(), markets };
    markets.catch(() => {
      if (marketsCache?.markets === markets) marketsCache = null;
    });
  }
  return marketsCache.markets;
}

/** Ladders still taking stakes, nearest deadline first. */
function openLadders(markets: MarketView[], stock: Stock): Series[] {
  const t = now();
  return groupSeries(markets).filter(
    (s) => s.feedId === stock.equityFeedId && t < s.lockTs && s.markets.some((m) => m.status === "open"),
  );
}

function parseTime(input: string): number | null {
  if (/^\d{9,11}$/.test(input.trim())) return Number(input.trim());
  const ms = Date.parse(input);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// ---------------------------------------------------------------- tools

export async function tokenBalance(owner: PublicKey): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, owner);
    return BigInt((await (await connection()).getTokenAccountBalance(ata)).value.amount);
  } catch {
    return 0n;
  }
}

export async function gapNow(symbol?: string): Promise<string> {
  const stock = findStock(symbol);
  const [all, tokenPrices] = await Promise.all([
    quotes(),
    apiOk<{ prices: Record<string, TokenPrice> }>("/api/token-prices")
      .then((r) => r.prices)
      .catch(() => ({}) as Record<string, TokenPrice>),
  ]);
  const q = all[stock.equityFeedId];
  if (!q) throw new Error(`No Pyth price for ${stock.symbol}: ${UNPRICED}.`);
  const t = now();
  // Same rule as the app: no Pyth print for half an hour means nothing is trading.
  const session = t - q.publishTime > 1800 ? "closed" : usSession(t);
  const bell = nextOpeningBell(t, 0, 0, await pythHolidays(stock).catch(() => new Set<string>()));

  const lines = [
    `${stock.symbol} on Pyth (${stock.pythSymbol}): ${usd(q.price)}, published ${t - q.publishTime}s ago.`,
    session === "regular"
      ? "US regular session is open (closes 16:00 ET)."
      : session === "extended"
        ? `US regular session is closed; only thin pre-market, after-hours or overnight trading. Next opening bell ${etTime(bell, false)} (in ${countdown(bell - t)}).`
        : `Nothing trades ${stock.symbol} right now (Friday 20:00 to Sunday 20:00 ET, or a holiday). Next opening bell ${etTime(bell, false)} (in ${countdown(bell - t)}).`,
  ];
  for (const tok of stock.tokenized) {
    const fromPyth = tok.issuer === "xStocks" ? all[stock.xstockFeedId] : undefined;
    const price = fromPyth?.price ?? tokenPrices[tok.mint]?.price;
    lines.push(
      price
        ? `${tok.symbol} on Solana: ${usd(price)} (${pct(price / q.price - 1, 2)} vs Pyth, via ${fromPyth ? "Pyth" : "Jupiter"}).`
        : `${tok.symbol} on Solana: no liquid price.`,
    );
  }
  if (session !== "regular") {
    lines.push(
      "While Wall Street is closed, the token's distance from the last Pyth print is the gap forming: the next opening print is likely to move the stock by about that much at once.",
    );
  }
  return lines.join("\n");
}

export async function ladders(symbol?: string): Promise<string> {
  const stock = findStock(symbol);
  const [markets, q] = await Promise.all([allMarkets(), spotOf(stock)]);
  const open = openLadders(markets, stock);
  if (open.length === 0)
    return `No ${stock.symbol} ladders are taking stakes right now. The keeper opens one for every weekday opening bell.`;
  const t = now();
  const lines = [`${stock.symbol} on Pyth now: ${usd(q.price)}.`];
  for (const s of open) {
    const median = impliedMedian(seriesCurve(s));
    lines.push(
      "",
      `Ladder settling ${etTime(s.resolveTs, false)} (until="${new Date(s.resolveTs * 1000).toISOString()}"), on the first Pyth print at or after it.`,
      `Stakes close ${etTime(s.lockTs, false)} (in ${countdown(s.lockTs - t)}).${median !== null ? ` Crowd 50% level: ${usd(median)}.` : ""}`,
      `YES pays if ${stock.symbol} prints at or above the strike; NO if below. Prices in cents are the pool odds.`,
    );
    for (const m of s.markets) {
      const p = impliedProbability(m);
      lines.push(
        `  ${usd(m.strike).padStart(9)}  ${p === null ? "no price" : `YES ${Math.round(p * 100)}¢ / NO ${Math.round((1 - p) * 100)}¢`}  pool ${money(m.yesPool + m.noPool)}`,
      );
    }
  }
  return lines.join("\n");
}

export type CoverArgs = {
  stock?: string;
  shares?: number;
  holder?: string;
  until?: string;
  starts_below?: number;
  down_to?: number;
};

export async function planCover(args: CoverArgs) {
  const stock = findStock(args.stock);
  const [markets, q] = await Promise.all([allMarkets(), spotOf(stock)]);
  const spot = q.price;

  let shares = args.shares;
  let sharesNote = "";
  if (args.holder) {
    let owner: PublicKey;
    try {
      owner = new PublicKey(args.holder);
    } catch {
      throw new Error("holder must be a Solana address.");
    }
    const { holdings } = await apiOk<{ holdings: Holding[] }>(`/api/holdings?owner=${owner.toBase58()}`);
    const held = holdings.filter((h) => h.stock === stock.symbol);
    shares = held.reduce((a, h) => a + h.shares, 0);
    sharesNote = held.length ? ` (read from mainnet: ${held.map((h) => `${h.shares} ${h.symbol}`).join(", ")})` : "";
    if (!(shares > 0))
      throw new Error(`${args.holder} holds no ${stock.symbol} tokens on mainnet. Pass shares instead.`);
  }
  if (!(shares && shares > 0)) throw new Error("Pass shares (how many to cover) or holder (a mainnet wallet to read).");

  const open = openLadders(markets, stock);
  if (open.length === 0) throw new Error(`No ${stock.symbol} ladder is taking stakes right now.`);
  let series = open.at(-1)!; // the furthest deadline spans the weekend
  if (args.until) {
    const ts = parseTime(args.until);
    const match = open.find((s) => s.resolveTs === ts);
    if (!match) {
      const choices = open.map((s) => new Date(s.resolveTs * 1000).toISOString()).join(", ");
      throw new Error(`No open ladder settles at ${args.until}. Open deadlines: ${choices}.`);
    }
    series = match;
  }

  const below = series.markets
    .filter((m) => m.status === "open" && m.strike < spot)
    .map((m) => m.strike)
    .sort((a, b) => b - a);
  if (below.length === 0)
    throw new Error(`Every strike on this ladder is above ${usd(spot)}; there is nothing to cover.`);
  const pick = (k: number | undefined, what: string) => {
    if (k === undefined) return undefined;
    if (!below.includes(k))
      throw new Error(`${what} must be one of the strikes below the price: ${below.map((x) => usd(x)).join(", ")}.`);
    return k;
  };
  const range = defaultCoverRange(series.markets, spot)!;
  const from = pick(args.starts_below, "starts_below") ?? range.from;
  const to = pick(args.down_to, "down_to") ?? range.to;
  if (to > from) throw new Error("down_to must be at or below starts_below.");

  const plan = coverPlan(series.markets, spot, shares, UNIT, { from, to });
  return { stock, spot, shares, sharesNote, series, plan };
}

export function describePlan(p: Awaited<ReturnType<typeof planCover>>): string[] {
  const { stock, spot, shares, sharesNote, series, plan } = p;
  const value = shares * spot;
  const lines = [
    `Cover for ${shares} ${stock.symbol}${sharesNote}, until ${etTime(series.resolveTs, false)}.`,
    `It settles on the first Pyth ${stock.symbol} print at or after that time. Pyth now: ${usd(spot)}; position worth ${usd(value)}.`,
    `Cost: ${money(plan.cost)} (${pct(Number(plan.cost) / UNIT / value, 2).replace("+", "")} of the position). Pays at most ${money(plan.maxPayout)}.`,
    `It pays nothing if ${stock.symbol} opens at or above ${usd(plan.legs[0].strike)}. Below that:`,
  ];
  let paid = 0n;
  for (const leg of plan.legs) {
    paid += leg.payout;
    const loss = shares * (spot - leg.strike);
    lines.push(`  opens below ${usd(leg.strike)}: position down more than ${usd(loss)}, cover pays ${money(paid)}`);
  }
  lines.push(
    `Built from ${plan.legs.length} NO stake${plan.legs.length > 1 ? "s" : ""}: ${plan.legs.map((l) => `${usd(l.strike)} ${tokens(l.stake)}`).join(", ")}.`,
    "Cover never pays more than the position loses, and trails the loss by less than one strike step.",
    `Stakes close ${etTime(series.lockTs, false)}.`,
  );
  return lines;
}

/** `buyWith` names the tool that buys on this server: the agent's own wallet, or a transaction for the caller's. */
export async function quoteCover(args: CoverArgs, buyWith: "buy_cover" | "cover_transaction"): Promise<string> {
  const p = await planCover(args);
  if (p.plan.legs.length === 0) throw new Error("Those choices cover nothing. Widen starts_below or down_to.");
  const cost = Math.ceil((Number(p.plan.cost) / UNIT) * 100) / 100;
  return [
    ...describePlan(p),
    "",
    buyWith === "buy_cover"
      ? `To buy it, call buy_cover with the same arguments and max_cost of at least ${cost}.`
      : "To buy it, call cover_transaction with the same arguments and the buyer's wallet as account.",
    "Pools move as others trade, so the price can change a little.",
  ].join("\n");
}

/** Any wallet's positions: what each pays, what's settled, what's ready to claim. Read-only. */
export async function positionsOf(owner: PublicKey, opts: { claimHint: string }): Promise<string> {
  const program = getProgram(await connection());
  const [positions, markets, balance] = await Promise.all([
    fetchPositions(program, owner),
    allMarkets(),
    tokenBalance(owner),
  ]);
  const byAddress = new Map(markets.map((m) => [m.address, m]));
  const lines = [`Wallet ${owner.toBase58()}: ${money(balance)}.`];
  if (positions.length === 0) return [...lines, "No positions yet. Quote cover with quote_cover."].join("\n");

  const t = now();
  let claimable = 0n;
  let claimableCount = 0;
  const due = new Set<number>();
  const rows = positions
    .flatMap((p) => {
      const m = byAddress.get(p.market);
      return m ? [{ p, m }] : [];
    })
    .sort((a, b) => a.m.resolveTs - b.m.resolveTs || b.m.strike - a.m.strike);

  for (const s of groupSeries(rows.map((r) => r.m))) {
    const stock = STOCKS.find((x) => x.equityFeedId === s.feedId)?.symbol ?? "?";
    const mine = rows.filter((r) => r.m.resolveTs === s.resolveTs && r.m.feedId === s.feedId);
    const settled = mine.find((r) => r.m.status === "resolved")?.m;
    const state = settled
      ? `settled on a Pyth print of ${usd(settled.settlePrice!, 4)}`
      : t >= s.resolveTs
        ? "deadline passed, not settled yet (call settle)"
        : t >= s.lockTs
          ? `stakes closed, settles in ${countdown(s.resolveTs - t)}`
          : `open, settles in ${countdown(s.resolveTs - t)}`;
    if (!settled && t >= s.resolveTs) due.add(s.resolveTs);
    lines.push("", `${stock} ladder ${etTime(s.resolveTs, false)}: ${state}.`);
    for (const { p, m } of mine) {
      for (const [side, stake] of [
        ["yes", p.yesAmount],
        ["no", p.noAmount],
      ] as const) {
        if (stake === 0n) continue;
        const cond = side === "yes" ? `at or above ${usd(m.strike)}` : `below ${usd(m.strike)}`;
        if (m.status === "open") {
          lines.push(
            `  ${side.toUpperCase()} ${usd(m.strike)}: staked ${money(stake)}, pays about ${money(currentPayout(m, side, stake))} if ${stock} opens ${cond}`,
          );
        }
      }
      if (m.status !== "open") {
        const owed = positionPayout(m, p.yesAmount, p.noAmount) ?? 0n;
        claimable += owed;
        claimableCount += 1;
        const result = m.status === "voided" ? "voided, stake refunded" : `${m.outcome!.toUpperCase()} won`;
        lines.push(`  ${usd(m.strike)}: ${result}; you receive ${money(owed)}`);
      }
    }
    // NO stakes stack like cover: below a strike, every NO leg at or above it pays too.
    const noLegs = mine.filter(({ p, m }) => m.status === "open" && p.noAmount > 0n);
    if (noLegs.length > 1) {
      let total = 0n;
      const steps = noLegs.map(({ p, m }) => {
        total += currentPayout(m, "no", p.noAmount);
        return `below ${usd(m.strike)}: ${money(total)}`;
      });
      lines.push(`  In total, if ${stock} opens ${steps.join("; ")}`);
    }
  }
  if (claimableCount > 0)
    lines.push(
      "",
      `Ready to claim: ${money(claimable)} from ${claimableCount} position${claimableCount > 1 ? "s" : ""}. ${opts.claimHint}`,
    );
  else if (due.size > 0) lines.push("", "Call settle to settle the ladders whose deadline has passed.");
  return lines.join("\n");
}

export async function settle(): Promise<string> {
  const t = now();
  const due = groupSeries((await allMarkets()).filter((m) => m.status === "open" && t >= m.resolveTs));
  if (due.length === 0) return "Nothing is due: every ladder whose deadline has passed is already settled.";
  const lines: string[] = [];
  for (const s of due) {
    const r = await api<{ resolved?: string[]; voided?: string[]; signatures?: string[] }>("/api/settle", {
      markets: s.markets.map((m) => m.address),
    });
    const when = etTime(s.resolveTs, false);
    if (r.status === 425)
      lines.push(`${when}: Pyth hasn't published the print for the deadline yet. Try again in a few seconds.`);
    else if (r.status >= 400) lines.push(`${when}: ${r.body.error}`);
    else {
      lines.push(
        `${when}: settled ${r.body.resolved?.length ?? 0} strike(s)${r.body.voided?.length ? `, voided ${r.body.voided.length}` : ""}.`,
        ...(r.body.signatures ?? []).map((sig) => `  ${explorerTx(sig)}`),
      );
    }
  }
  const after = new Map((await allMarkets(true)).map((m) => [m.address, m]));
  for (const s of due) {
    const done = s.markets.map((m) => after.get(m.address)!).filter((m) => m && m.status === "resolved");
    if (done.length === 0) continue;
    lines.push(
      `Pyth print ${usd(done[0].settlePrice!, 4)} published ${etTime(done[0].settlePublishTime!)}: ` +
        done.map((m) => `${usd(m.strike)} ${m.outcome!.toUpperCase()}`).join(", "),
    );
  }
  return [...lines, "Anyone can settle: the program accepts only the first Pyth print at or after the deadline."].join(
    "\n",
  );
}

export async function coverIxs(owner: PublicKey, plan: CoverPlan): Promise<TransactionInstruction[]> {
  const program = getProgram(await connection());
  const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, owner);
  const legs = await Promise.all(
    plan.legs.map((l) =>
      placeBetIxs(program, { market: new PublicKey(l.market.address), bettor: owner, side: "no", amount: l.stake }),
    ),
  );
  return [createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, COLLATERAL_MINT), ...legs.flat()];
}

/** Parses a wallet address, refusing program-derived ones (they can't sign). */
export function walletAddress(input: string): PublicKey {
  try {
    const key = new PublicKey(input);
    if (PublicKey.isOnCurve(key.toBytes())) return key;
  } catch {
    // fall through
  }
  throw new Error(`${input} is not a wallet address.`);
}

/**
 * The cover quote_cover describes, as an unsigned transaction for `account` to
 * sign and send. For agents that hold their own keys; nothing is spent here.
 */
export async function coverTransaction(args: CoverArgs & { account: string }): Promise<string> {
  const owner = walletAddress(args.account);
  const p = await planCover(args);
  if (p.plan.legs.length === 0) throw new Error("Those choices cover nothing. Widen starts_below or down_to.");
  const c = await connection();
  const [balance, { blockhash, lastValidBlockHeight }] = await Promise.all([
    tokenBalance(owner),
    c.getLatestBlockhash("confirmed"),
  ]);
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(
    ...(await coverIxs(owner, p.plan)),
  );
  return [
    ...describePlan(p),
    "",
    balance < p.plan.cost
      ? `This wallet has ${money(balance)} on devnet and needs ${money(p.plan.cost)}. Test funds: POST ${APP_URL}/api/faucet with {"owner": "${owner.toBase58()}"}, then ask for a fresh transaction.`
      : `The wallet has ${money(balance)}, enough to pay ${money(p.plan.cost)}.`,
    `Unsigned transaction (base64, Solana devnet, fee payer ${owner.toBase58()}). Sign it with that wallet and send it within about a minute:`,
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
  ].join("\n");
}

/** Every finished ladder, newest first, with the Pyth print that settled it. */
export async function trackRecord(): Promise<string> {
  const done = groupSeries((await allMarkets()).filter((m) => m.status !== "open")).reverse();
  if (done.length === 0) return "No ladder has settled yet.";
  let strikes = 0;
  let voided = 0;
  const lines = done.map((s) => {
    const stock = STOCKS.find((x) => x.equityFeedId === s.feedId)?.symbol ?? "?";
    const settled = s.markets.find((m) => m.status === "resolved");
    const v = s.markets.filter((m) => m.status === "voided").length;
    strikes += s.markets.length - v;
    voided += v;
    if (!settled) return `${stock} ${etTime(s.resolveTs)}: no valid print, all ${v} strikes refunded.`;
    const lag = settled.settlePublishTime! - s.resolveTs;
    const results = s.markets.map(
      (m) => `${usd(m.strike)} ${m.status === "voided" ? "refunded" : m.outcome!.toUpperCase()}`,
    );
    return (
      `${stock} ${etTime(s.resolveTs)}: Pyth print ${usd(settled.settlePrice!, 4)}, published ` +
      `${lag === 0 ? "exactly at the deadline" : `${lag}s after it`}. ${results.join(", ")}.`
    );
  });
  return [
    `${done.length} ladders, ${strikes} strikes settled by Pyth, ${voided} voided. Each settled on the first Pyth print at or after its deadline, checked on-chain.`,
    ...lines,
  ].join("\n");
}
