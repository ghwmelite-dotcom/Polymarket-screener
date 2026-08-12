# PolyCop Screener

An alerts-only Cloudflare Worker that screens public Polymarket wallet activity. It is a research and notification tool: it does not place trades, custody funds, copy orders, or promise executable performance.

## What is implemented

- Hourly scheduled ingestion with bounded candidate selection.
- Queue-based wallet audits, bounded pagination, strict record validation, and raw-data snapshots in R2.
- Versioned, conservative normalized replay and adverse-scaling risk score.
- D1-backed audit history, seven-day notification cooldown, and idempotent Telegram outbox.
- KV as a 24-hour rejection cache only—never as the source of truth.
- `/health` endpoint, TypeScript strict checking, and unit tests.

## Local setup

```powershell
Copy-Item .dev.vars.example .dev.vars
npm.cmd install --ignore-scripts --no-audit --no-fund
npm.cmd run check
npm.cmd test
npx.cmd wrangler d1 migrations apply polymarket-screener --local
npx.cmd wrangler dev --local
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` only in your local `.dev.vars` or production secret store. They are intentionally not included in this repository.

## Cloudflare provisioning before deployment

Create one D1 database, one KV namespace, one R2 bucket, and the two queues named in `wrangler.toml`; then replace only the placeholder binding IDs. Apply the migration remotely and add Telegram values with `wrangler secret put`. Do not deploy until local checks pass and the operator explicitly approves the production step.

## Important model limitation

Public trade history records observed completed trades, not the original order-book state, fill queue position, cancellation lifecycle, or the price available after the system observes a trader. The replay output is therefore a normalized historical screening metric—not an expected live P&L or execution guarantee. See [docs/architecture.md](docs/architecture.md).
