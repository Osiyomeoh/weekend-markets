/** A tokenized version of a stock on Solana mainnet (all are Token-2022). */
export type TokenizedStock = { symbol: string; issuer: string; mint: string };

/** Stocks we list, with the Pyth feeds that price them. */
export type Stock = {
  symbol: string;
  name: string;
  /** Pyth `Equity.US.<SYM>/USD`: trades 09:30-16:00 ET; markets settle on this. */
  equityFeedId: string;
  /** Pyth `Crypto.<SYM>X/USD`: the xStock, priced 24/7 on Solana. */
  xstockFeedId: string;
  /** Rough annualized volatility, used only to seed opening odds. */
  annualVol: number;
  /** Strike spacing in dollars. */
  tick: number;
  /** Mainnet tokens that track the stock, for reading what a wallet holds. */
  tokenized: TokenizedStock[];
};

export const STOCKS: Stock[] = [
  {
    symbol: "NVDA",
    name: "NVIDIA",
    equityFeedId: "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    xstockFeedId: "0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f",
    annualVol: 0.5,
    tick: 1,
    tokenized: [
      { symbol: "NVDAx", issuer: "xStocks", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
      { symbol: "NVDAon", issuer: "Ondo", mint: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo" },
    ],
  },
  {
    symbol: "AAPL",
    name: "Apple",
    equityFeedId: "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    xstockFeedId: "0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
    annualVol: 0.25,
    tick: 1,
    tokenized: [
      { symbol: "AAPLx", issuer: "xStocks", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
      { symbol: "AAPLon", issuer: "Ondo", mint: "123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo" },
    ],
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    equityFeedId: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    xstockFeedId: "0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
    annualVol: 0.6,
    tick: 2.5,
    tokenized: [
      { symbol: "TSLAx", issuer: "xStocks", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
      { symbol: "TSLAon", issuer: "Ondo", mint: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo" },
    ],
  },
  {
    symbol: "SPY",
    name: "S&P 500 ETF",
    equityFeedId: "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    xstockFeedId: "0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14",
    annualVol: 0.15,
    tick: 1,
    tokenized: [
      { symbol: "SPYx", issuer: "xStocks", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
      { symbol: "SPYon", issuer: "Ondo", mint: "k18WJUULWheRkSpSquYGdNNmtuE2Vbw1hpuUi92ondo" },
    ],
  },
];

export function normalizeFeedId(id: string): string {
  return (id.startsWith("0x") ? id : `0x${id}`).toLowerCase();
}

export function stockByEquityFeed(feedId: string): Stock | undefined {
  const id = normalizeFeedId(feedId);
  return STOCKS.find((s) => s.equityFeedId === id);
}

export function feedIdToBytes(feedId: string): number[] {
  const hex = normalizeFeedId(feedId).slice(2);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`bad feed id ${feedId}`);
  return Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export function bytesToFeedId(bytes: ArrayLike<number>): string {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
