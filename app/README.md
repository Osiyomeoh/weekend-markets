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
| `CRON_SECRET` | keeper | Shared secret for `POST /api/cron/tick`; the same value is the `CRON_SECRET` secret of the GitHub repository |

## Always-on keeper

`.github/workflows/keeper.yml` calls `POST /api/cron/tick` every 10 minutes. Each call settles every due ladder (one posted Pyth update per ladder) and opens the ladder for the next opening bell (weekdays 09:30 ET) for every stock our Pyth key can price. Calls are idempotent. Settlement is also permissionless, so anyone can settle from the app with "Settle now" without waiting for the keeper.

## Agents (MCP server)

The hosted endpoint is `src/app/mcp/route.ts` (stateless Streamable HTTP, no keys). The local server is `mcp/server.ts`; `mcp/tools.ts` defines the shared tools, `mcp/agent.ts` holds the logic, and `mcp/wallet.ts` the local agent's wallet. It signs with its own devnet wallet and reads prices, holdings, the faucet and settlement from the app's public routes, so it needs no keys and doesn't load `.env.local`.

| Variable | Default | |
|---|---|---|
| `AGENT_KEYPAIR` | `../keys/agent.json` | The agent's wallet; created on first use |
| `AGENT_MAX_SPEND` | `100` | Most one purchase may cost, in tUSDC |
| `WEEKEND_MARKETS_URL` | `https://weekend-markets.vercel.app` | App whose routes it calls |

Claude Code:

```bash
claude mcp add weekend-markets -e AGENT_MAX_SPEND=100 -- node "$PWD/node_modules/tsx/dist/cli.mjs" "$PWD/mcp/server.ts"
```

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`), with absolute paths:

```json
{
  "mcpServers": {
    "weekend-markets": {
      "command": "/opt/homebrew/bin/node",
      "args": ["<repo>/app/node_modules/tsx/dist/cli.mjs", "<repo>/app/mcp/server.ts"],
      "env": { "AGENT_MAX_SPEND": "100" }
    }
  }
}
```

## Commands

```bash
npm run dev                                   # app on http://localhost:3000
npm test                                      # ladder and cover math
npm run setup:devnet                          # operator keypair, SOL, test USDC mint
npm run series                                # open the ladder for the next opening bell
npx tsx scripts/add-liquidity.ts --depth 5000 # deepen open pools at current odds
npx tsx scripts/requote.ts --send             # move open ladders to the current pricing model
npm run tick                                  # one keeper pass: settle what's due, open the next ladder
npm run keeper                                # the same pass every minute
npm run status                                # every ladder, pools and outcomes
npm run smoke -- --url https://weekend-markets.vercel.app   # full user flow with a fresh wallet
npm run agent                                 # the MCP server, on stdio
npm run agent:smoke                           # the agent flow through the MCP protocol
npm run agent:smoke:hosted                    # the hosted /mcp endpoint through the protocol
npm run gaps                                  # rebuild the close-to-open history from Pyth
```
