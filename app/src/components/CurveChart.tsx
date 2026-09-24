"use client";

import { usd } from "@/lib/format";

type Point = { strike: number; p: number };
type Marker = { x: number; label: string; color: string };

/**
 * Crowd-implied P(settlement >= strike) across the ladder, with vertical
 * markers for the live price, the crowd's 50% level and (once settled) the
 * settlement price.
 */
export function CurveChart({ curve, raw, markers }: { curve: Point[]; raw: Point[]; markers: Marker[] }) {
  const W = 640;
  const H = 210;
  const pad = { l: 44, r: 16, t: 14, b: 30 };
  const xs = [...curve.map((c) => c.strike), ...raw.map((r) => r.strike), ...markers.map((m) => m.x)];
  if (xs.length === 0) return null;
  let lo = Math.min(...xs);
  let hi = Math.max(...xs);
  const span = hi - lo || Math.max(1, hi * 0.01);
  lo -= span * 0.08;
  hi += span * 0.08;
  const x = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - p) * (H - pad.t - pad.b);
  const path = curve.map((c, i) => `${i ? "L" : "M"}${x(c.strike).toFixed(1)},${y(c.p).toFixed(1)}`).join(" ");
  const area = curve.length
    ? `${path} L${x(curve.at(-1)!.strike).toFixed(1)},${y(0)} L${x(curve[0].strike).toFixed(1)},${y(0)} Z`
    : "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Crowd-implied probability curve">
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(p)}
            y2={y(p)}
            stroke="var(--line)"
            strokeDasharray={p === 0.5 ? "4 4" : undefined}
          />
          <text x={pad.l - 8} y={y(p) + 4} textAnchor="end" fontSize="11" fill="var(--faint)" className="num">
            {Math.round(p * 100)}%
          </text>
        </g>
      ))}
      {area && <path d={area} fill="var(--yes-soft)" />}
      {path && <path d={path} fill="none" stroke="var(--yes)" strokeWidth="2" />}
      {raw.map((r) => (
        <circle key={`r${r.strike}`} cx={x(r.strike)} cy={y(r.p)} r="3.5" fill="var(--panel)" stroke="var(--yes)" strokeWidth="1.5" />
      ))}
      {markers.map((m, i) => (
        <g key={m.label}>
          <line x1={x(m.x)} x2={x(m.x)} y1={pad.t} y2={H - pad.b} stroke={m.color} strokeWidth="1.5" strokeDasharray="3 3" />
          <text
            x={x(m.x)}
            y={pad.t + 10 + i * 13}
            textAnchor={x(m.x) > W * 0.7 ? "end" : "start"}
            dx={x(m.x) > W * 0.7 ? -5 : 5}
            fontSize="11"
            fill={m.color}
          >
            {m.label} {usd(m.x)}
          </text>
        </g>
      ))}
      {curve.map((c) => (
        <text key={`t${c.strike}`} x={x(c.strike)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--muted)" className="num">
          {c.strike.toFixed(c.strike % 1 ? 2 : 0)}
        </text>
      ))}
    </svg>
  );
}
