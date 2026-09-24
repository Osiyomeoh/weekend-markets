import type { Metadata } from "next";

import { CoverView } from "@/components/views/CoverView";

export const metadata: Metadata = {
  title: "Gap cover",
  description: "Protect a TSLA, TSLAx or TSLAon position until the next opening print. Priced live, bought in one transaction.",
};

export default function Page() {
  return <CoverView />;
}
