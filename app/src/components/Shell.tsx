"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

import { COLLATERAL_SYMBOL, explorerAddress, explorerTx, PROGRAM_ID } from "@/lib/config";
import { tokens } from "@/lib/format";

import { useApp } from "./AppState";

// The wallet button reads browser-only state, so it renders on the client only.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-9 w-32 rounded-lg border border-line bg-panel-2" /> },
);

const NAV = [
  { href: "/cover", label: "Cover" },
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
];

export function Shell({ children }: { children: ReactNode }) {
  const { wallet, balance, faucet, fauceting, myMarkets, toast, now, dismissToast } = useApp();
  const path = usePathname();
  const claimable = myMarkets.filter((m) => m.status !== "open").length;

  const nav = (
    <nav aria-label="Main" className="flex gap-1">
      {NAV.map((n) => {
        const active = path === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex-1 rounded-lg px-3 py-2 text-center text-sm transition sm:flex-none ${
              active ? "bg-panel-2 text-text" : "text-muted hover:text-text"
            }`}
          >
            {n.label}
            {n.href === "/portfolio" && claimable > 0 && (
              <span
                className="num ml-1.5 rounded-full bg-bell px-1.5 py-0.5 text-[10px] font-semibold text-bg"
                aria-label={`${claimable} to claim`}
              >
                {claimable}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5" aria-label="Weekend Markets home">
              <Bell />
              <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Weekend Markets</span>
            </Link>
            <div className="hidden md:block">{nav}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] text-muted lg:inline">
              Solana devnet
            </span>
            {wallet && (
              <>
                <span className="num hidden text-sm text-muted sm:inline" title="Test USDC balance">
                  {balance.data === null || balance.data === undefined ? "…" : tokens(balance.data)} {COLLATERAL_SYMBOL}
                </span>
                {(balance.data ?? 0n) < 100_000_000n && (
                  <button
                    onClick={faucet}
                    disabled={fauceting}
                    className="h-9 rounded-lg border border-line px-3 text-[13px] hover:border-faint disabled:opacity-50"
                  >
                    {fauceting ? "Sending…" : "Get test funds"}
                  </button>
                )}
              </>
            )}
            <WalletMultiButton />
          </div>
        </div>
        <div className="border-t border-line px-2 py-1.5 md:hidden">{nav}</div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-faint sm:px-6">
          <span>
            Devnet prototype · test funds only, no real money · prices by{" "}
            <a className="underline hover:text-text" href="https://pyth.network" target="_blank" rel="noreferrer">
              Pyth
            </a>
          </span>
          <span className="flex gap-4">
            <a className="underline hover:text-text" href={explorerAddress(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
              Program
            </a>
            <a className="underline hover:text-text" href="https://github.com/Osiyomeoh/weekend-markets" target="_blank" rel="noreferrer">
              Source
            </a>
          </span>
        </div>
      </footer>

      {toast && now - toast.at < 12 && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-lg border border-line bg-panel-2 px-4 py-3 text-sm shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <span>{toast.msg}</span>
            <button onClick={dismissToast} className="text-muted hover:text-text" aria-label="Dismiss">
              ×
            </button>
          </div>
          {toast.sig && (
            <a className="mt-1 block text-xs text-bell underline" href={explorerTx(toast.sig)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function Bell({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" stroke="var(--bell)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 20.5a2 2 0 0 0 4 0" stroke="var(--bell)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Page title block used at the top of each app page. */
export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
