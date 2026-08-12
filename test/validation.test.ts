import { describe, expect, it } from 'vitest';
import { leaderboardWallets, parseTrades } from '../src/validation';

const WALLET = '0x1111111111111111111111111111111111111111';
const CONDITION = `0x${'a'.repeat(64)}`;

describe('validation', () => {
  it('normalizes usable leaderboard addresses and removes duplicates', () => {
    expect(leaderboardWallets([{ proxyWallet: WALLET.toUpperCase() }, { address: WALLET }, { address: 'invalid' }], 10)).toEqual([WALLET]);
  });

  it('drops malformed records rather than coercing them', () => {
    const trades = parseTrades([{ proxyWallet: WALLET, side: 'BUY', asset: 'asset', conditionId: CONDITION, size: 10, price: 0.4, timestamp: 1 }, { proxyWallet: WALLET, side: 'BUY', asset: 'asset', conditionId: CONDITION, size: 10, price: 2, timestamp: 1 }], WALLET);
    expect(trades).toHaveLength(1);
  });
});
