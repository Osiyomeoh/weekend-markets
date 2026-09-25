import type { Metadata } from "next";

import { PreIpoView } from "@/components/views/PreIpoView";

export const metadata: Metadata = {
  title: "Pre-IPO gap",
  description:
    "PreStocks pre-IPO tokens trade around the clock on Solana; the companies don't trade at all. The gap between each token and PreStocks' own mark, live.",
};

export default function Page() {
  return <PreIpoView />;
}
