import type { ClosedPosition, Trade } from './types';

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const CONDITION = /^0x[a-fA-F0-9]{64}$/;

export function normalizeWallet(value: unknown): string | null {
  return typeof value === 'string' && ADDRESS.test(value) ? value.toLowerCase() : null;
}

export function parseTrades(input: unknown, wallet: string): Trade[] {
  if (!Array.isArray(input)) return [];
  const parsed: Trade[] = [];
  for (const row of input) {
    if (typeof row !== 'object' || row === null) continue;
    const candidate = row as Record<string, unknown>;
    const proxyWallet = normalizeWallet(candidate.proxyWallet);
    const side = candidate.side;
    const asset = candidate.asset;
    const conditionId = candidate.conditionId;
    const size = candidate.size;
    const price = candidate.price;
    const timestamp = candidate.timestamp;
    if (
      proxyWallet !== wallet ||
      (side !== 'BUY' && side !== 'SELL') ||
      typeof asset !== 'string' || asset.length === 0 ||
      typeof conditionId !== 'string' || !CONDITION.test(conditionId) ||
      typeof size !== 'number' || !Number.isFinite(size) || size <= 0 ||
      typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price >= 1 ||
      typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp) || timestamp <= 0
    ) continue;
    parsed.push({
      proxyWallet,
      side,
      asset,
      conditionId: conditionId.toLowerCase(),
      size,
      price,
      timestamp,
      ...(typeof candidate.transactionHash === 'string' ? { transactionHash: candidate.transactionHash } : {}),
      ...(typeof candidate.outcome === 'string' ? { outcome: candidate.outcome } : {}),
      ...(typeof candidate.title === 'string' ? { title: candidate.title } : {})
    });
  }
  return parsed.sort((a, b) => a.timestamp - b.timestamp || a.conditionId.localeCompare(b.conditionId));
}

export function parseClosedPositions(input: unknown, wallet: string): ClosedPosition[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((row): ClosedPosition[] => {
    if (typeof row !== 'object' || row === null) return [];
    const item = row as Record<string, unknown>;
    const proxyWallet = normalizeWallet(item.proxyWallet);
    if (proxyWallet !== wallet || typeof item.totalBought !== 'number' || item.totalBought <= 0 || !Number.isFinite(item.totalBought) || typeof item.realizedPnl !== 'number' || !Number.isFinite(item.realizedPnl) || typeof item.timestamp !== 'number' || !Number.isSafeInteger(item.timestamp)) return [];
    return [{ proxyWallet, totalBought: item.totalBought, realizedPnl: item.realizedPnl, timestamp: item.timestamp }];
  }).sort((a, b) => a.timestamp - b.timestamp);
}

export function leaderboardWallets(input: unknown, limit: number): string[] {
  const rows = Array.isArray(input) ? input : typeof input === 'object' && input !== null && Array.isArray((input as Record<string, unknown>).data) ? (input as Record<string, unknown>).data as unknown[] : [];
  const unique = new Set<string>();
  for (const item of rows) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const address = normalizeWallet(row.proxyWallet ?? row.address ?? row.walletAddress);
    if (address) unique.add(address);
    if (unique.size >= limit) break;
  }
  return [...unique];
}
