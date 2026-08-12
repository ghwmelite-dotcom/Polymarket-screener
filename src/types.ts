export interface Env {
  DB: D1Database;
  BLACKLIST_KV: KVNamespace;
  RAW_SNAPSHOTS: R2Bucket;
  WALLET_AUDITS: Queue<WalletAuditMessage>;
  ALERT_DELIVERY: Queue<AlertDeliveryMessage>;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  LEADERBOARD_URL?: string;
}

export interface WalletAuditMessage {
  walletAddress: string;
  runId: string;
  discoveredAt: string;
}

export interface AlertDeliveryMessage {
  outboxId: string;
}

export interface Trade {
  proxyWallet: string;
  side: 'BUY' | 'SELL';
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  transactionHash?: string;
  outcome?: string;
  title?: string;
}

export interface ClosedPosition {
  proxyWallet: string;
  totalBought: number;
  realizedPnl: number;
  timestamp: number;
}

export interface ReplayResult {
  observedCount: number;
  validCount: number;
  baseNetPnl: number;
  stressedNetPnl: number;
  maxDrawdownPct: number;
  adverseScalingScore: number;
  reasons: string[];
  qualifies: boolean;
}
