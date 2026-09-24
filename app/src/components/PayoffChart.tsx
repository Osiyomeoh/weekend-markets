"use client";

import { COLLATERAL_DECIMALS } from "@/lib/config";
import { CoverPlan, coverPayout } from "@/lib/cover";
import { usd } from "@/lib/format";

const UNIT = 10 ** COLLATERAL_DECIMALS;

/**
 * Profit and loss at settlement for the position alone and for the position
 * with cover (net of what the cover costs), across settlement prices.
 */
export function PayoffChart({ plan, spot, shares }: { plan: CoverPlan; spot: number; shares: number }) {
  const W = 640;
  const H = 220;
  const pad = { l: 58, r: 16, t: 16, b: 30 };
  const strikes = plan.legs.map((l) => l.strike);
  const lowest = Math.min(spot, ...strikes);
  const step = Math.max(spot * 0.02, strikes.length > 1 ? strikes[0] - strikes[1] : spot - lowest);
  const lo = lowest - step;
  const hi = spot + step * 0.75;

  const cost = Number(plan.cost) / UNIT;
  const bare = (p: number) => shares * (p - spot);
  const covered = (p: number) => bare(p) + Number(coverPayout(plan, p)) / UNIT - cost;

  const ys = [bare(lo), bare(hi), covered(lo), covered(hi), -cost, 0];
  let yLo = Math.min(...ys);
  let yHi = Math.max(...ys);
  const ySpan = yHi - yLo || 1;
  yLo -= ySpan * 0.08;
  yHi += ySpan * 0.08;

  const x = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((yHi - v) / (yHi - yLo)) * (H - pad.t - pad.b);

  // Straight segments between strikes, vertical at each strike: the cover is a staircase.
  const breaks = [lo, ...[...strikes].sort((a, b) => a - b), hi];
  const coveredPath = breaks
    .flatMap((b, i) => {
      const pts: string[] = [];
      if (i > 0) pts.push(`L${x(b).toFixed(1)},${y(covered(b - 1e-9)).toFixed(1)}`);
      pts.push(`${i ? "L" : "M"}${x(b).toFixed(1)},${y(covered(b)).toFixed(1)}`);
      return pts;
    })
    .join(" ");
  const barePath = `M${x(lo)},${y(bare(lo))} L${x(hi)},${y(bare(hi))}`;
  const ticks = niceTicks(yLo, yHi, 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Profit and loss at settlement, with and without cover">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : "2 4"} />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)" className="num">
            {t < 0 ? "−" : t > 0 ? "+" : ""}
            {usd(Math.abs(t), 0)}
          </text>
        </g>
      ))}
      {strikes.map((s) => (
        <g key={s}>
          <line x1={x(s)} x2={x(s)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" />
          <text x={x(s)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--muted)" className="num">
            {s.toFixed(s % 1 ? 2 : 0)}
          </text>
        </g>
      ))}
      <line x1={x(spot)} x2={x(spot)} y1={pad.t} y2={H - pad.b} stroke="var(--text)" strokeWidth="1.2" strokeDasharray="3 3" />
      <text x={x(spot) - 5} y={pad.t + 10} textAnchor="end" fontSize="11" fill="var(--text)">
        Pyth now {usd(spot)}
      </text>
      <path d={barePath} fill="none" stroke="var(--no)" strokeWidth="1.8" strokeDasharray="5 4" />
      <path d={coveredPath} fill="none" stroke="var(--bell)" strokeWidth="2.2" strokeLinejoin="round" />
      <g fontSize="11">
        <line x1={pad.l + 8} x2={pad.l + 26} y1={pad.t + 6} y2={pad.t + 6} stroke="var(--no)" strokeWidth="1.8" strokeDasharray="5 4" />
        <text x={pad.l + 32} y={pad.t + 10} fill="var(--muted)">Holding only</text>
        <line x1={pad.l + 8} x2={pad.l + 26} y1={pad.t + 22} y2={pad.t + 22} stroke="var(--bell)" strokeWidth="2.2" />
        <text x={pad.l + 32} y={pad.t + 26} fill="var(--muted)">With cover, after its cost</text>
      </g>
    </svg>
  );
}

/** Round-number gridlines covering [lo, hi], always including zero if in range. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(Math.abs(t) < step / 1e6 ? 0 : t);
  return out;
}
