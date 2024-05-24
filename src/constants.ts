import { UInt64 } from 'o1js';

export const NUMBERS_IN_TICKET = 6;

export const TICKET_PRICE = UInt64.from(10 * 10 ** 9); // #TODO change to field in smartcontract
export const BLOCK_PER_ROUND = 480; // Aproximate blocks per day

export const SCORE_COEFFICIENTS = [1, 10, 100, 1000, 10000, 100000]; // Should be updated with apropriate probaility
