import { POLICY_VERSION, scoreWallet } from './scoring';
import type { AlertDeliveryMessage, Env, WalletAuditMessage } from './types';
import { leaderboardWallets, parseClosedPositions, parseTrades } from './validation';

const DATA_API = 'https://data-api.polymarket.com';
const MAX_CANDIDATES = 50;
const MAX_TRADE_PAGES = 5;
const PAGE_SIZE = 500;
const COOLDOWN_DAYS = 7;
const HYPOTHETICAL_TEST_USD = 25;
const NORMALIZED_STARTING_EQUITY = 1_000;

const isoNow = () => new Date().toISOString();
const id = () => crypto.randomUUID();

async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'polycop-screener/0.1' } });
  if (!response.ok) throw new Error(`upstream ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}

async function auditWallet(env: Env, message: WalletAuditMessage): Promise<void> {
  const pages: unknown[] = [];
  const closedPages: unknown[] = [];
  for (let offset = 0; offset < MAX_TRADE_PAGES * PAGE_SIZE; offset += PAGE_SIZE) {
    const url = new URL(`${DATA_API}/trades`);
    url.searchParams.set('user', message.walletAddress);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const page = await fetchJson(url.toString());
    pages.push(page);
    if (!Array.isArray(page) || page.length < PAGE_SIZE) break;
  }
  for (let offset = 0; offset < MAX_TRADE_PAGES * 50; offset += 50) {
    const url = new URL(`${DATA_API}/closed-positions`);
    url.searchParams.set('user', message.walletAddress);
    url.searchParams.set('limit', '50');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sortBy', 'TIMESTAMP');
    url.searchParams.set('sortDirection', 'ASC');
    const page = await fetchJson(url.toString());
    closedPages.push(page);
    if (!Array.isArray(page) || page.length < 50) break;
  }
  const rawPayload = JSON.stringify({ trades: pages, closedPositions: closedPages });
  const sourceHash = await hash(rawPayload);
  const snapshotKey = `trades/${message.walletAddress}/${Date.now()}-${sourceHash}.json`;
  await env.RAW_SNAPSHOTS.put(snapshotKey, rawPayload, { httpMetadata: { contentType: 'application/json' }, customMetadata: { source: 'data-api/trades', policyVersion: POLICY_VERSION } });
  const observed = pages.flatMap((page) => Array.isArray(page) ? page : []);
  const result = scoreWallet(observed.length, parseTrades(observed, message.walletAddress), parseClosedPositions(closedPages.flatMap((page) => Array.isArray(page) ? page : []), message.walletAddress));
  const auditId = id();
  const now = isoNow();
  const qualification = result.qualifies ? 'qualified' : result.validCount === 0 ? 'inconclusive' : 'rejected';
  const blacklistWrite = qualification === 'rejected' ? env.BLACKLIST_KV.put(`reject:${message.walletAddress}`, 'policy-v1', { expirationTtl: 86_400 }) : Promise.resolve();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO wallets(address, status, first_seen_at, last_seen_at, last_audited_at, policy_version, score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET status=excluded.status, last_seen_at=excluded.last_seen_at, last_audited_at=excluded.last_audited_at, policy_version=excluded.policy_version, score=excluded.score, updated_at=excluded.updated_at')
      .bind(message.walletAddress, qualification === 'qualified' ? 'qualified' : 'rejected', now, now, now, POLICY_VERSION, result.baseNetPnl - result.adverseScalingScore * 10, now),
    env.DB.prepare('INSERT INTO audits(id, wallet_address, policy_version, source_snapshot_key, source_hash, observed_trade_count, valid_trade_count, simulation_net_pnl, stressed_net_pnl, max_drawdown_pct, adverse_scaling_score, qualification_status, reasons_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(auditId, message.walletAddress, POLICY_VERSION, snapshotKey, sourceHash, result.observedCount, result.validCount, result.baseNetPnl, result.stressedNetPnl, result.maxDrawdownPct, result.adverseScalingScore, qualification, JSON.stringify(result.reasons), now)
  ]);
  if (result.qualifies) {
    const outboxId = id();
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString();
    const created = await env.DB.prepare('INSERT INTO alert_outbox(id, wallet_address, audit_id, idempotency_key, state, created_at, updated_at) SELECT ?, ?, ?, ?, \'pending\', ?, ? WHERE NOT EXISTS (SELECT 1 FROM alert_outbox WHERE wallet_address = ? AND state IN (\'pending\', \'sending\', \'sent\') AND created_at >= ?)')
      .bind(outboxId, message.walletAddress, auditId, `${message.walletAddress}:${POLICY_VERSION}:${sourceHash}`, now, now, message.walletAddress, cooldownCutoff)
      .run();
    if ((created.meta.changes ?? 0) === 1) await env.ALERT_DELIVERY.send({ outboxId });
  }
  await blacklistWrite;
}

async function deliverAlert(env: Env, message: AlertDeliveryMessage): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('Telegram secrets are not configured');
  const claimed = await env.DB.prepare("UPDATE alert_outbox SET state = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'pending'").bind(isoNow(), message.outboxId).run();
  if ((claimed.meta.changes ?? 0) !== 1) return;
  const row = await env.DB.prepare('SELECT o.id, o.wallet_address, a.simulation_net_pnl, a.stressed_net_pnl, a.max_drawdown_pct, a.adverse_scaling_score FROM alert_outbox o JOIN audits a ON a.id=o.audit_id WHERE o.id=?').bind(message.outboxId).first<{ id: string; wallet_address: string; simulation_net_pnl: number; stressed_net_pnl: number; max_drawdown_pct: number; adverse_scaling_score: number }>();
  if (!row) throw new Error('outbox audit missing');
  const baseScenarioPnl = HYPOTHETICAL_TEST_USD * (row.simulation_net_pnl / NORMALIZED_STARTING_EQUITY);
  const stressScenarioPnl = HYPOTHETICAL_TEST_USD * (row.stressed_net_pnl / NORMALIZED_STARTING_EQUITY);
  const historicalDrawdownAmount = HYPOTHETICAL_TEST_USD * (row.max_drawdown_pct / 100);
  const profileUrl = `https://polymarket.com/profile/${row.wallet_address}`;
  const formatSignedUsd = (value: number) => `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
  const text = `🚨 POLYCOP WALLET SCREENING ALERT 🚨\n\n• Wallet: <code>${row.wallet_address}</code>\n• Normalized replay P&L: $${row.simulation_net_pnl.toFixed(2)}\n• Simulation Max Drawdown: ${row.max_drawdown_pct.toFixed(1)}%\n• Adverse Scaling Score: ${row.adverse_scaling_score.toFixed(1)}\n\n🧪 HYPOTHETICAL TEST SCENARIO (NOT A RECOMMENDATION)\n• Test cap: $${HYPOTHETICAL_TEST_USD.toFixed(2)} maximum\n• If this wallet's historical normalized base result repeated: ${formatSignedUsd(baseScenarioPnl)}\n• Under the model's stressed assumptions: ${formatSignedUsd(stressScenarioPnl)}\n• Historical drawdown equivalent: up to -$${historicalDrawdownAmount.toFixed(2)}\n\nThese are backtest illustrations—not predicted P&L. You can lose the full test amount. Review current positions, market liquidity, timing, and the live order book before acting.\n\n📈 REFERENCE RISK LIMITS:\n• Do not exceed $150 per market\n• Do not enter without checking the live order book\n\n<a href="${profileUrl}">👉 Open this wallet's Polymarket profile</a>`;
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
    if (!response.ok) throw new Error(`Telegram ${response.status}`);
    const now = isoNow();
    await env.DB.batch([
      env.DB.prepare("UPDATE alert_outbox SET state='sent', sent_at=?, updated_at=? WHERE id=?").bind(now, now, row.id),
      env.DB.prepare('UPDATE wallets SET last_alerted_at=?, updated_at=? WHERE address=?').bind(now, now, row.wallet_address)
    ]);
  } catch (error) {
    await env.DB.prepare("UPDATE alert_outbox SET state='pending', last_error=?, updated_at=? WHERE id=?").bind(error instanceof Error ? error.message : 'unknown error', isoNow(), row.id).run();
    throw error;
  }
}

export default {
  async scheduled(_event, env, ctx): Promise<void> {
    const runId = id();
    const now = isoNow();
    await env.DB.prepare("INSERT INTO ingestion_runs(id, state, started_at) VALUES (?, 'running', ?)").bind(runId, now).run();
    try {
      const payload = await fetchJson(env.LEADERBOARD_URL ?? `${DATA_API}/v1/leaderboard?timePeriod=ALL&orderBy=PNL&limit=${MAX_CANDIDATES}`);
      const wallets = leaderboardWallets(payload, MAX_CANDIDATES);
      const eligible: string[] = [];
      for (const wallet of wallets) if (!(await env.BLACKLIST_KV.get(`reject:${wallet}`))) eligible.push(wallet);
      await env.WALLET_AUDITS.sendBatch(eligible.map((walletAddress) => ({ body: { walletAddress, runId, discoveredAt: now } })));
      await env.DB.prepare("UPDATE ingestion_runs SET state='completed', candidate_count=?, enqueued_count=?, completed_at=? WHERE id=?").bind(wallets.length, eligible.length, isoNow(), runId).run();
    } catch (error) {
      await env.DB.prepare("UPDATE ingestion_runs SET state='failed', error_summary=?, completed_at=? WHERE id=?").bind(error instanceof Error ? error.message.slice(0, 500) : 'unknown error', isoNow(), runId).run();
      throw error;
    }
    ctx.waitUntil(Promise.resolve());
  },
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const body = message.body as WalletAuditMessage | AlertDeliveryMessage;
        if ('walletAddress' in body) await auditWallet(env, body);
        else await deliverAlert(env, body);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
  async fetch(request): Promise<Response> {
    return new URL(request.url).pathname === '/health' ? Response.json({ ok: true, service: 'polymarket-screener' }) : new Response('Not Found', { status: 404 });
  }
} satisfies ExportedHandler<Env>;
