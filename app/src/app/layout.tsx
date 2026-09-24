import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppStateProvider } from "@/components/AppState";
import { Shell } from "@/components/Shell";

import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description =
  "Hedge the hours Wall Street is closed. Cover for TSLAx and TSLAon holders, settled on Solana by the first Pyth price after the bell.";

export const metadata: Metadata = {
  metadataBase: new URL("https://weekend-markets.vercel.app"),
  title: { default: "Weekend Markets · Gap cover for tokenized stocks", template: "%s · Weekend Markets" },
  description,
  openGraph: { siteName: "Weekend Markets", type: "website", description },
  twitter: { card: "summary_large_image", description },
};

export const viewport: Viewport = { themeColor: "#0a0c0f", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <AppStateProvider>
            <Shell>{children}</Shell>
          </AppStateProvider>
        </Providers>
      </body>
    </html>
  );
}
