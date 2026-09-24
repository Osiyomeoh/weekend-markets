"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { ReactNode } from "react";

import { RPC_URL } from "@/lib/config";

export function Providers({ children }: { children: ReactNode }) {
  // Wallets implementing the Wallet Standard (Phantom, Solflare, Backpack...)
  // are detected automatically, so no adapters are listed here.
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
