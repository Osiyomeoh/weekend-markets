# Weekend Markets

**Trade where a stock will open on Monday — while Wall Street is closed. Settled on Solana by Pyth, with no one able to pick the price.**

Tokenized stocks (xStocks, Ondo) trade 24/7 on Solana, but the US equity market that prices them is open 32.5 hours a week. Weekend Markets lets people take a view on the next print — "NVDA opens at or above $180.00 on Monday" — and settles it trustlessly against the Pyth equity feed.

> Built for the Solana Foundation **Stocklana** hackathon (Sep 2026). This README separates what is built from what is planned; nothing below is claimed unless it is in this repo.

## How settlement works

Each market is a binary, parimutuel pool: YES stakes vs NO stakes, winners split the whole pot pro rata. No AMM, no house, no fee — the program can't be insolvent.

`resolve` is permissionless. Anyone can settle a market by passing a Pyth `PriceUpdateV2` account, and the program only accepts **the first Pyth print at or after `resolve_ts`**:

```
prev_publish_time < resolve_ts <= publish_time <= resolve_ts + window
```

The `prev_publish_time` check is what stops a resolver from choosing whichever price inside the window suits them. The update must also be fully Wormhole-verified, owned by the Pyth receiver program, for the market's feed, positive, and have a confidence interval within the market's bound.

If one side has no stake, or nobody posts a valid price before the void delay expires, the market voids and every stake is refunded.

## Status

### Built
- Anchor program (`programs/weekend-markets`), Anchor 1.2, `pyth-solana-receiver-sdk` 2.0 (`pro-compatible`, i.e. the post-Aug-2026 Pyth Core receiver):
  - `create_market`, `place_bet`, `resolve`, `void_market`, `claim`, `close_market`
- Tests: 12 unit tests for settlement math, 25 LiteSVM integration tests covering every instruction and failure path (stale / cherry-picked / forged / partially verified / low-confidence prices, one-sided and empty pools, rounding dust, double claims, unauthorized claims and closes).

### In progress (this hackathon)
- Devnet deployment
- TypeScript client + resolver (posts the Pyth update and resolves in one transaction)
- Web app: strike ladder per stock, crowd-implied open vs live xStock price, bet / claim / faucet

### Planned (after the hackathon)
- Scalar "range" markets, AI-assisted market creation and non-price resolution (Perps & Prediction Markets hackathon, Colosseum World's Fair)

## Build and test

Requires Rust, Solana CLI 4.1.x and Anchor 1.2.0.

```bash
anchor build --arch v0
cargo test -p weekend-markets
```

`--arch v0` targets SBPF v0, which every cluster and LiteSVM support (Anchor 1.2 defaults to v3).

## License

MIT
