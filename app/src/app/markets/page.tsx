import type { Metadata } from "next";

import { MarketsView } from "@/components/views/MarketsView";

export const metadata: Metadata = {
  title: "Markets",
  description: "Strike ladders on where TSLA prints at the bell, each settled by the first Pyth price after the deadline.",
};

export default function Page() {
  return <MarketsView />;
}
