# PolyCop Screener Architecture

## Purpose and boundary

PolyCop Screener is an alerts-only system that identifies Polymarket wallets whose public trading history satisfies a transparent, versioned risk policy. It does not place trades, hold private keys, copy orders, or provide an execution guarantee.

## Runtime flow

1. An hourly Cloudflare Cron fetches a bounded leaderboard page from Polymarket's public Data API.
2. The Worker validates the payload, normalizes wallet addresses, eliminates recently rejected wallets from a KV cache, and writes candidate jobs to a Queue.
3. Queue consumers retrieve a bounded, paginated public trade/activity history per candidate, archive the source snapshot in R2, and calculate policy metrics.
4. A D1 transaction stores the audit, upgrades a qualifying wallet, and atomically creates a Telegram outbox record only when its qualification state is newly alertable.
5. A separate outbox consumer delivers Telegram messages with an idempotency key and retry budget.

## Storage responsibilities

| Service | Responsibility | Not used for |
| --- | --- | --- |
| D1 | Authoritative wallet status, audit data, score versions, cooldown, outbox | Unbounded raw payload storage |
| KV | 24-hour temporary rejection cache | Alert cooldown or any correctness decision |
| R2 | Raw source snapshots and payload hashes for reproducibility | Queryable operational state |
| Queues | Bounded, retryable wallet-audit and delivery work | Long-term history |

## Risk model v1

Qualification requires a minimum population of observed trades, a positive normalized replay under base and stressed assumptions, a maximum drawdown ceiling, and no severe adverse-scaling score. Win rate is an input, never a standalone qualification signal.

The replay starts with a virtual USD 1,000 equity balance, uses 10% target sizing, and records both base and stressed fills. It is a historical normalization tool rather than a prediction of live fill quality. Calculations explicitly distinguish `BUY`, `SELL`, non-trade activity, realized outcome where known, and unknown/invalid records.

The adverse-scaling score groups entries by wallet, condition, and asset. It requires increasing notional exposure within a bounded time window while the mark moves adversely. It is a penalty signal, not a binary claim of intent.

## Reliability invariants

- All external data is schema validated before use.
- All D1 statements use bound parameters.
- No outbound fan-out is unbounded; concurrency, pages, candidates, retries, and payload sizes have hard limits.
- D1, not KV, enforces the seven-day alert cooldown.
- Telegram delivery is idempotent and retries do not create duplicate alerts.
- Raw payloads retain a retrieval time, endpoint, request parameters, schema version, and content hash.
- Every audit records the policy version and simulation assumptions.

## Deployment boundary

Local tests and `wrangler dev` are prerequisites to deployment. Production bindings and Telegram secrets are intentionally absent from version control and must only be supplied after explicit operator approval.
