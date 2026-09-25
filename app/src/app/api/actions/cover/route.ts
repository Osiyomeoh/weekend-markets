import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { COLLATERAL_MINT, COLLATERAL_SYMBOL, RPC_URL } from "@/lib/config";
import { etTime, tokens, usd } from "@/lib/format";
import { coverOffer, CoverOffer, coverTransaction, OfferError } from "@/lib/server/coverAction";
import { drip } from "@/lib/server/faucet";
import { mainnetHoldings } from "@/lib/server/holdings";
import { loadOperator } from "@/lib/server/operator";
import { STOCKS } from "@/lib/stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Gap cover as a Solana Action (a Blink): GET describes it with a live quote,
 * POST returns an unsigned transaction that any wallet, or any agent with a
 * wallet, can sign. A new devnet wallet gets test funds first, so one click
 * works from nothing.
 */

const TSLA = STOCKS.find((s) => s.symbol === "TSLA")!;
const EXAMPLE_SHARES = 10;
const MAX_SHARES = 10_000;
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": DEVNET,
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
const money = (raw: bigint) => `${tokens(raw)} ${COLLATERAL_SYMBOL}`;

function summary(o: CoverOffer): string {
  const floor = o.plan.legs.at(-1)!.strike;
  return (
    `Cover for ${o.shares} ${o.stock.symbol} until ${etTime(o.series.resolveTs, false)} costs ${money(o.plan.cost)} ` +
    `and pays up to ${money(o.plan.maxPayout)} if ${o.stock.symbol} opens below ${usd(floor)}.`
  );
}

export async function OPTIONS() {
  return new Response(null, { headers: HEADERS });
}

export async function GET(request: Request) {
  const base = new URL(request.url).origin;
  const actions = [
    { type: "transaction", label: "Cover what I hold", href: "/api/actions/cover?shares=held" },
    { type: "transaction", label: `Cover ${EXAMPLE_SHARES} TSLA`, href: `/api/actions/cover?shares=${EXAMPLE_SHARES}` },
    {
      type: "transaction",
      label: "Cover",
      href: "/api/actions/cover?shares={shares}",
      parameters: [
        { type: "number", name: "shares", label: "Shares of TSLA", required: true, min: 0.01, max: MAX_SHARES },
      ],
    },
  ];
  const common = {
    type: "action",
    icon: `${base}/opengraph-image`,
    title: "Hedge the hours Wall Street is closed",
    label: "Cover",
  };
  try {
    const offer = await coverOffer(new Connection(RPC_URL, "confirmed"), TSLA, EXAMPLE_SHARES);
    return json({
      ...common,
      description:
        `Tesla is ${usd(offer.spot)} on Pyth. ${summary(offer)} It never pays more than you lose, and settles ` +
        `on the first Pyth price after the bell. "Cover what I hold" reads your TSLAx and TSLAon on mainnet. ` +
        `Solana devnet with test USDC: a new wallet gets test funds automatically.`,
      links: { actions },
    });
  } catch (e) {
    return json({
      ...common,
      description: e instanceof OfferError ? e.message : "Quotes are unavailable right now.",
      disabled: true,
      links: { actions },
    });
  }
}

export async function POST(request: Request) {
  let owner: PublicKey;
  try {
    const body = (await request.json()) as { account?: unknown };
    owner = new PublicKey(String(body.account));
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error();
  } catch {
    return json({ message: "account must be a wallet address" }, 400);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  try {
    const param = new URL(request.url).searchParams.get("shares") ?? "";
    let shares: number;
    if (param === "held") {
      shares = (await mainnetHoldings(owner)).filter((h) => h.stock === TSLA.symbol).reduce((a, h) => a + h.shares, 0);
      if (!(shares > 0))
        throw new OfferError("This wallet holds no TSLAx or TSLAon on mainnet. Enter a number of shares.");
    } else {
      shares = Number(param);
      if (!(shares > 0 && shares <= MAX_SHARES)) throw new OfferError(`Enter between 0.01 and ${MAX_SHARES} shares.`);
    }
    shares = Math.round(shares * 10_000) / 10_000;

    const offer = await coverOffer(connection, TSLA, shares);

    // One click from nothing: fund a new devnet wallet before handing it the transaction.
    const ata = getAssociatedTokenAddressSync(COLLATERAL_MINT, owner);
    const [balance, lamports] = await Promise.all([
      connection
        .getTokenAccountBalance(ata)
        .then((b) => BigInt(b.value.amount))
        .catch(() => 0n),
      connection.getBalance(owner),
    ]);
    let funded = "";
    if (balance < offer.plan.cost || lamports < 0.01 * LAMPORTS_PER_SOL) {
      const r = await drip(connection, loadOperator(), owner);
      if (r.tokens > 0n) funded = `Sent you ${money(r.tokens)} of test funds first. `;
      else if (r.lamports > 0) funded = "Sent you devnet SOL for fees first. ";
      if (balance + r.tokens < offer.plan.cost) {
        throw new OfferError(
          `Cover for ${shares} TSLA costs ${money(offer.plan.cost)}; this wallet has ${money(balance + r.tokens)}. Try fewer shares.`,
        );
      }
    }

    const tx = await coverTransaction(connection, owner, offer);
    return json({
      type: "transaction",
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      message: `${funded}${summary(offer)}`,
    });
  } catch (e) {
    if (e instanceof OfferError) return json({ message: e.message }, 422);
    return json({ message: (e as Error).message }, 500);
  }
}
