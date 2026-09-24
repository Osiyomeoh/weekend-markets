"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";

import { COLLATERAL_SYMBOL } from "@/lib/config";
import { etTime } from "@/lib/format";

type Props = {
  connected: boolean;
  funded: boolean;
  fauceting: boolean;
  hasOpen: boolean;
  claimable: number;
  nextSettle: number | null;
  onFaucet: () => void;
};

/** The whole flow in four steps, each ticking off from on-chain state. */
export function GetStarted({ connected, funded, fauceting, hasOpen, claimable, nextSettle, onFaucet }: Props) {
  const { setVisible } = useWalletModal();
  const toCover = () => document.getElementById("cover")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const toPositions = () => document.getElementById("positions")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const steps = [
    {
      title: "Connect a wallet",
      body: "Phantom, Solflare or Backpack. Everything runs on Solana devnet with test money.",
      done: connected,
      action: connected ? null : { label: "Connect", onClick: () => setVisible(true) },
    },
    {
      title: "Get test funds",
      body: `1,000 ${COLLATERAL_SYMBOL} plus a little devnet SOL for fees, free.`,
      done: funded,
      action: connected && !funded ? { label: fauceting ? "Sending…" : "Get funds", onClick: onFaucet } : null,
    },
    {
      title: "Buy cover",
      body: "Enter your shares and buy cover in one transaction, or trade any strike.",
      done: hasOpen || claimable > 0,
      action: funded && !hasOpen ? { label: "Go to cover", onClick: toCover } : null,
    },
    {
      title: "Get paid at the bell",
      body:
        claimable > 0
          ? `${claimable} position${claimable > 1 ? "s" : ""} settled and ready to claim.`
          : `Settles on the first Pyth print${nextSettle ? ` at ${etTime(nextSettle, false)}` : ""}. Then claim in one click.`,
      done: false,
      action: claimable > 0 ? { label: "Claim", onClick: toPositions } : null,
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <section aria-label="Get started" className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => (
        <div key={s.title} className={`flex flex-col gap-1 px-4 py-3 ${i === current ? "bg-panel-2" : "bg-panel"}`}>
          <div className="flex items-center gap-2">
            <span
              className={`num flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                s.done ? "bg-yes text-bg" : i === current ? "bg-bell text-bg" : "border border-line text-muted"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className={`text-sm font-medium ${s.done ? "text-muted" : ""}`}>{s.title}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted">{s.body}</p>
          {s.action && (
            <button
              onClick={s.action.onClick}
              className={`mt-1 self-start rounded-md px-3 py-1.5 text-xs font-medium ${
                i === current ? "bg-bell text-bg" : "border border-line hover:border-faint"
              }`}
            >
              {s.action.label}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
