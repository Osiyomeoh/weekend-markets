# Weekend Markets app

Next.js 16 app, TypeScript client, keeper and operator scripts. See the [project README](../README.md) for what the product is.

## Environment

Put these in `app/.env.local` (gitignored) for local development, or in the Vercel project settings.

| Variable | Needed by | |
|---|---|---|
| `PYTH_API_KEY` | prices, settlement | Pyth Hermes access token (required since the August 2026 Core upgrade) |
| `OPERATOR_SECRET_KEY` or `OPERATOR_KEYPAIR_PATH` | faucet, settlement, scripts | Operator wallet: base58 or JSON secret key, or a path to a keypair file |
| `NEXT_PUBLIC_RPC_URL` | everything | Devnet RPC. Default `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_COLLATERAL_MINT` | everything | Test USDC mint. Defaults to the deployed one |
| `NEXT_PUBLIC_OPERATOR` | everything | Only markets created by this wallet are listed. Defaults to the deployed one |
| `MAINNET_RPC_URL` | holdings | Mainnet RPC for reading tokenized stock balances. Default is the public endpoint |
| `PYTH_HERMES_URL` | prices, settlement | Default `https://pyth.dourolabs.app/hermes` |

## Commands

```bash
npm run dev                                   # app on http://localhost:3000
npm test                                      # ladder and cover math
npm run setup:devnet                          # operator keypair, SOL, test USDC mint
npm run series -- --resolve monday-open       # create a TSLA ladder settling at Monday's open
npx tsx scripts/add-liquidity.ts --depth 5000 # deepen open pools at current odds
npm run keeper -- --watch                     # settle markets as they come due
npm run status                                # every ladder, pools and outcomes
npm run smoke -- --url https://weekend-markets.vercel.app   # full user flow with a fresh wallet
```
