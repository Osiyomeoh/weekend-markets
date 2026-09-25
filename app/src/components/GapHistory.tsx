"use client";

import { useState } from "react";

import history from "@/data/tsla-gaps.json";
import { pct, usd } from "@/lib/format";

const PAD = { top: 16, right: 8, bottom: 26, left: 36 };
const GAP_PX = 2;
const SHARES = 10;

type Gap = (typeof history.gaps)[number];

const month = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${month(iso)}`;

/** A bar anchored square at the zero line with a 4px rounded far end. */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0));
  if (y1 < y0) {
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

/**
 * Every close-to-open move in TSLA since Pyth's equity history begins, from
 * Pyth prints (see scripts/gaps.ts). Direction is encoded by position above or
 * below zero; color repeats it.
 */
export function GapHistory() {
  const gaps: Gap[] = history.gaps;
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's real width, so text stays at its pixel size on a phone.
  const [W, setW] = useState(900);
  const measure = (el: HTMLDivElement | null) => {
    if (!el) return;
    const fit = (width: number) => setW(Math.max(280, Math.round(width)));
    fit(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  };
  if (gaps.length === 0) return null;
  const H = W < 560 ? 200 : 230;

  const lo = Math.min(-0.02, ...gaps.map((g) => g.gap));
  const hi = Math.max(0.02, ...gaps.map((g) => g.gap));
  const yMin = Math.floor(lo * 50) / 50; // round out to 2% steps
  const yMax = Math.ceil(hi * 50) / 50;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const col = (W - PAD.left - PAD.right) / gaps.length;
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + 1e-9; t += 0.02) ticks.push(Math.round(t * 100) / 100);

  const moves = gaps.map((g) => Math.abs(g.gap));
  const mean = moves.reduce((a, m) => a + m, 0) / moves.length;
  const over2 = moves.filter((m) => m > 0.02).length;
  const worstIndex = moves.indexOf(Math.max(...moves));
  const worst = gaps[worstIndex];
  const months = gaps.flatMap((g, i) => (i === 0 || g.to.slice(0, 7) !== gaps[i - 1].to.slice(0, 7) ? [i] : []));
  const shown = hover !== null ? gaps[hover] : null;

  return (
    <div className="mt-4 rounded-xl border border-line bg-panel">
      <div className="grid gap-px bg-line sm:grid-cols-3">
        {[
          [pct(mean, 1).replace("+", ""), "average move at the open"],
          [`${over2} of ${gaps.length}`, "opens moved more than 2%"],
          [
            pct(worst.gap, 1),
            `on ${day(worst.to)}: ${usd(SHARES * worst.close * Math.abs(worst.gap), 0)} on ${SHARES} shares, at the bell`,
          ],
        ].map(([value, label]) => (
          <div key={label} className="bg-panel px-5 py-4">
            <div className="num text-2xl font-semibold tracking-tight">{value}</div>
            <div className="mt-1 text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="border-t border-line px-3 pt-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <span className="text-xs uppercase tracking-wider text-muted">
            TSLA, close to next open, every session since {day(gaps[0].from)}
          </span>
          <span className="num min-h-[1rem] text-xs text-muted" aria-live="polite">
            {shown
              ? `${day(shown.from)} close ${usd(shown.close)} → ${day(shown.to)} open ${usd(shown.open)}: ${pct(shown.gap, 2)}${shown.weekend ? " (over a weekend or holiday)" : ""}`
              : "Hover or tap a bar"}
          </span>
        </div>
        <div ref={measure}>
          <svg
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="mt-2 block w-full"
            role="img"
            aria-label={`Close-to-open moves in TSLA: average ${pct(mean, 1).replace("+", "")}, largest ${pct(worst.gap, 1)} on ${day(worst.to)}`}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--line)"
                  strokeWidth={t === 0 ? 1.5 : 1}
                  strokeDasharray={t === 0 ? undefined : "2 4"}
                />
                <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)" className="num">
                  {t === 0 ? "0" : `${t > 0 ? "+" : ""}${Math.round(t * 100)}%`}
                </text>
              </g>
            ))}
            {months.map((i) => (
              <text
                key={i}
                x={PAD.left + i * col + GAP_PX / 2}
                y={H - 8}
                fontSize="11"
                fill="var(--faint)"
                className="num"
              >
                {month(gaps[i].to)}
              </text>
            ))}
            {gaps.map((g, i) => {
              const x = PAD.left + i * col + GAP_PX / 2;
              const w = Math.max(1, col - GAP_PX);
              const up = g.gap >= 0;
              return (
                <g key={g.to} onMouseEnter={() => setHover(i)}>
                  <path
                    d={barPath(x, w, y(0), y(g.gap))}
                    fill={up ? "var(--yes)" : "var(--no)"}
                    opacity={hover === null || hover === i ? 0.9 : 0.35}
                  />
                  {/* Hit target: the whole column, taller than the bar. */}
                  <rect
                    x={x - GAP_PX / 2}
                    y={PAD.top}
                    width={col}
                    height={H - PAD.top - PAD.bottom}
                    fill="transparent"
                  />
                </g>
              );
            })}
            <text
              x={Math.min(PAD.left + worstIndex * col + col + 6, W - 110)}
              y={y(worst.gap) + 4}
              fontSize="12"
              fill="var(--text)"
              className="num"
            >
              {pct(worst.gap, 1)}, {day(worst.to)}
            </text>
          </svg>
        </div>
        <p className="px-1 pb-4 pt-2 text-xs leading-relaxed text-faint">
          Close is the first Pyth print at or after 16:00 ET; open is the first at or after 09:30 ET, the same rule the
          ladders settle on. Source: Pyth {`Equity.US.TSLA/USD`}, whose history starts in July 2026.
        </p>
        <div className="sr-only">
          <table>
            <caption>TSLA close-to-open moves from Pyth</caption>
            <thead>
              <tr>
                <th>Close</th>
                <th>Open</th>
                <th>Move</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.to}>
                  <td>
                    {g.from} {usd(g.close)}
                  </td>
                  <td>
                    {g.to} {usd(g.open)}
                  </td>
                  <td>{pct(g.gap, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
