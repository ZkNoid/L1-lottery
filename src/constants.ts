import { PublicKey, UInt64 } from 'o1js';

export const NUMBERS_IN_TICKET = 6;

export const TICKET_PRICE = UInt64.from(1 * 10 ** 9);
export const BLOCK_PER_ROUND = 480; // Approximate blocks per 1 day

export const SCORE_COEFFICIENTS = [0, 90, 324, 2187, 26244, 590490, 31886460]; // Should be updated with appropriate probability

export const PRECISION = 1000;
export const COMMISSION = 100; // 10% commission

export const mockWinningCombination = [1, 1, 1, 1, 1, 1];

export const treasury = PublicKey.fromBase58(
  'B62qm9d3Ff7DQMpc59wNv9d6R9mSqRKbtHsPs53ZBGr27Y7Cj1poEmc'
);
