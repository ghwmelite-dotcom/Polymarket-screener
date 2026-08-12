import type { ReplayResult, Trade } from './types';

export const POLICY_VERSION = 'v1.0.0';
const STARTING_EQUITY = 1_000;
const TARGET_POSITION_FRACTION = 0.10;
const BASE_SLIPPAGE = 0.01;
const STRESSED_SLIPPAGE = 0.03;
const MIN_VALID_TRADES = 30;
const MAX_DRAWDOWN_PCT = 30;

function replay(trades: Trade[], slippage: number): { netPnl: number; maxDrawdownPct: number } {
  let equity = STARTING_EQUITY;
  let peak = equity;
  let maxDrawdown = 0;
  for (const trade of trades) {
    const riskBudget = Math.min(equity * TARGET_POSITION_FRACTION, 150);
    const fillPrice = trade.side === 'BUY' ? Math.min(0.999, trade.price * (1 + slippage)) : Math.max(0.001, trade.price * (1 - slippage));
    const notional = Math.min(riskBudget, trade.size * fillPrice);
    // A public trade stream does not supply a later executable exit price. This is deliberately
    // a conservative mark-normalized replay, not a claim to reconstruct wallet P&L.
    const edge = trade.side === 'BUY' ? (trade.price - fillPrice) / fillPrice : (fillPrice - trade.price) / fillPrice;
    equity += notional * edge;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
  }
  return { netPnl: equity - STARTING_EQUITY, maxDrawdownPct: maxDrawdown };
}

export function adverseScalingScore(trades: Trade[]): number {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades.filter((item) => item.side === 'BUY')) {
    const key = `${trade.conditionId}:${trade.asset}`;
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }
  let score = 0;
  for (const group of groups.values()) {
    let streak = 0;
    let prior: Trade | undefined;
    for (const current of group) {
      const isWithinDay = prior !== undefined && current.timestamp - prior.timestamp <= 86_400;
      const adverseMove = prior !== undefined && current.price < prior.price * 0.97;
      const increasedNotional = prior !== undefined && current.size * current.price > prior.size * prior.price * 1.25;
      streak = isWithinDay && adverseMove && increasedNotional ? streak + 1 : 0;
      if (streak >= 3) score += 1 + (streak - 3) * 0.5;
      prior = current;
    }
  }
  return score;
}

export function scoreWallet(observedCount: number, trades: Trade[]): ReplayResult {
  const reasons: string[] = [];
  const base = replay(trades, BASE_SLIPPAGE);
  const stressed = replay(trades, STRESSED_SLIPPAGE);
  const adverseScaling = adverseScalingScore(trades);
  if (trades.length < MIN_VALID_TRADES) reasons.push(`insufficient valid trades: ${trades.length}/${MIN_VALID_TRADES}`);
  if (base.netPnl <= 0) reasons.push('base replay is not positive');
  if (stressed.netPnl <= 0) reasons.push('stressed replay is not positive');
  if (base.maxDrawdownPct >= MAX_DRAWDOWN_PCT) reasons.push(`drawdown exceeds ${MAX_DRAWDOWN_PCT}%`);
  if (adverseScaling >= 2) reasons.push('adverse scaling risk is elevated');
  return {
    observedCount,
    validCount: trades.length,
    baseNetPnl: base.netPnl,
    stressedNetPnl: stressed.netPnl,
    maxDrawdownPct: base.maxDrawdownPct,
    adverseScalingScore: adverseScaling,
    reasons,
    qualifies: reasons.length === 0
  };
}
