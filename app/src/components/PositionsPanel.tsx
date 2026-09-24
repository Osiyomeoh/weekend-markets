"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useState } from "react";

import { COLLATERAL_SYMBOL } from "@/lib/config";
import { etTime, tokens, usd } from "@/lib/format";
import { MarketView, PositionView, useSendIxs, useWalletKey } from "@/lib/hooks";
import { currentPayout, positionPayout } from "@/lib/ladder";
import { claimIxs, getProgram } from "@/lib/program";
import { stockByEquityFeed } from "@/lib/stocks";

export function PositionsPanel({
  positions,
  markets,
  onChanged,
  notify,
}: {
  positions: PositionView[];
  markets: MarketView[];
  onChanged: () => void;
  notify: (msg: string, sig?: string) => void;
}) {
  const { connection } = useConnection();
  const wallet = useWalletKey();
  const sendIxs = useSendIxs();
  const [busy, setBusy] = useState<string | null>(null);
  const byAddress = new Map(markets.map((m) => [m.address, m]));
  const rows = positions
    .map((p) => ({ p, m: byAddress.get(p.market) }))
    .filter((r): r is { p: PositionView; m: MarketView } => !!r.m)
    .sort((a, b) => b.m.resolveTs - a.m.resolveTs);

  if (!wallet) return null;

  async function claim(m: MarketView) {
    if (!wallet) return;
    setBusy(m.address);
    try {
      const sig = await sendIxs(await claimIxs(getProgram(connection), { market: new PublicKey(m.address), owner: wallet }));
      notify("Claimed", sig);
      onChanged();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="positions" className="scroll-mt-4 rounded-xl border border-line bg-panel">
      <header className="border-b border-line px-5 py-3 text-sm font-medium">Your cover and positions</header>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">Nothing yet. Buy cover above, or pick Yes or No on any strike.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <tbody>
              {rows.map(({ p, m }) => {
                const owed = positionPayout(m, p.yesAmount, p.noAmount);
                return (
                  <tr key={p.address} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">
                        {symbolOf(m)} ≥ <span className="num">{usd(m.strike)}</span>
                      </div>
                      <div className="text-xs text-faint">{etTime(m.resolveTs, false)}</div>
                    </td>
                    <td className="num px-3 py-3 text-xs">
                      {p.yesAmount > 0n && <div className="text-yes">YES {tokens(p.yesAmount)}</div>}
                      {p.noAmount > 0n && <div className="text-no">NO {tokens(p.noAmount)}</div>}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {m.status === "open" ? (
                        <OpenPayouts m={m} p={p} symbol={symbolOf(m)} />
                      ) : m.status === "voided" ? (
                        "Voided · full refund"
                      ) : (
                        `Settled at ${usd(m.settlePrice!)} · ${m.outcome?.toUpperCase()} won`
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {owed === null ? (
                        <span className="text-xs text-faint">—</span>
                      ) : (
                        <button
                          onClick={() => claim(m)}
                          disabled={!!busy}
                          className="num rounded-md border border-line px-3 py-1.5 text-xs hover:border-faint disabled:opacity-40"
                        >
                          {busy === m.address ? "…" : owed > 0n ? `Claim ${tokens(owed)} ${COLLATERAL_SYMBOL}` : "Close position"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function symbolOf(m: MarketView): string {
  return stockByEquityFeed(m.feedId)?.symbol ?? "?";
}

/** Plain-language payouts for an open position, at the pools as they stand. */
function OpenPayouts({ m, p, symbol }: { m: MarketView; p: PositionView; symbol: string }) {
  return (
    <div className="num space-y-0.5">
      {p.noAmount > 0n && (
        <div>
          Below {usd(m.strike)}: pays <span className="text-text">~{tokens(currentPayout(m, "no", p.noAmount))}</span>
        </div>
      )}
      {p.yesAmount > 0n && (
        <div>
          At or above {usd(m.strike)}: pays <span className="text-text">~{tokens(currentPayout(m, "yes", p.yesAmount))}</span>
        </div>
      )}
      <div className="text-faint">if {symbol} settles there</div>
    </div>
  );
}
