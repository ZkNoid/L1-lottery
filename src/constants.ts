import { UInt64 } from 'o1js';

export const NUMBERS_IN_TICKET = 6;

export const TICKET_PRICE = UInt64.from(10 * 10 ** 9); // #TODO change to field in smartcontract
export const BLOCK_PER_ROUND = 480; // Aproximate blocks per day

export const SCORE_COEFFICIENTS = [0, 90, 324, 2187, 26244, 590490, 31886460]; // Should be updated with apropriate probaility

export const PRESICION = 1000;
export const COMMISION = 30; // 3% comission

export const mockWinningCombination = [1, 1, 1, 1, 1, 1];
