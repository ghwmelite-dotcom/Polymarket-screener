import { describe, expect, it } from 'vitest';
import { adverseScalingScore, scoreWallet } from '../src/scoring';
import type { Trade } from '../src/types';

const wallet = '0x1111111111111111111111111111111111111111';
const conditionId = `0x${'a'.repeat(64)}`;
const trade = (timestamp: number, price = 0.5, size = 50): Trade => ({ proxyWallet: wallet, side: 'BUY', asset: 'yes-token', conditionId, size, price, timestamp });

describe('risk scoring', () => {
  it('identifies repeated adverse, increasing entries in one asset', () => {
    const history = [trade(1, 0.9, 10), trade(2, 0.8, 30), trade(3, 0.7, 60), trade(4, 0.6, 120), trade(5, 0.5, 240)];
    expect(adverseScalingScore(history)).toBeGreaterThan(0);
  });

  it('does not qualify an undersampled history', () => {
    const result = scoreWallet(2, [trade(1), trade(2)]);
    expect(result.qualifies).toBe(false);
    expect(result.reasons.some((reason) => reason.startsWith('insufficient valid trades'))).toBe(true);
  });
});
