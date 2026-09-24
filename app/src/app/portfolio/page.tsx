import type { Metadata } from "next";
import { Suspense } from "react";

import { PortfolioView } from "@/components/views/PortfolioView";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Your cover and positions, and anything ready to claim.",
};

export default function Page() {
  // PortfolioView reads ?address=, which needs a Suspense boundary on a static page.
  return (
    <Suspense>
      <PortfolioView />
    </Suspense>
  );
}
