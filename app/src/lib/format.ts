import { COLLATERAL_DECIMALS } from "./config";

const UNIT = 10 ** COLLATERAL_DECIMALS;

export function usd(x: number, digits = 2): string {
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function pct(x: number, digits = 1): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

export function tokens(raw: bigint, digits = 2): string {
  return (Number(raw) / UNIT).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function toRaw(amount: string): bigint | null {
  if (!/^\d*(\.\d{0,6})?$/.test(amount.trim()) || amount.trim() === "" || amount.trim() === ".") return null;
  const [whole, frac = ""] = amount.trim().split(".");
  const raw = BigInt(whole || "0") * BigInt(UNIT) + BigInt(frac.padEnd(COLLATERAL_DECIMALS, "0"));
  return raw > 0n ? raw : null;
}

/** e.g. "Mon Sep 28, 09:30:00 ET" */
export function etTime(unix: number, withSeconds = true): string {
  const s = new Date(unix * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  });
  return `${s} ET`;
}

export function countdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s.toString().padStart(2, "0")}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}
