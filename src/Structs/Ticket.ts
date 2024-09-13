import {
  Field,
  Struct,
  Provable,
  UInt32,
  Poseidon,
  Bool,
  PublicKey,
  UInt64,
} from 'o1js';
import { NUMBERS_IN_TICKET, SCORE_COEFFICIENTS } from '../constants.js';

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

export class Ticket extends Struct({
  numbers: Provable.Array(UInt32, NUMBERS_IN_TICKET),
  owner: PublicKey,
  amount: UInt64,
}) {
  static from(
    numbers: number[] | UInt32[],
    owner: PublicKey,
    amount: number
  ): Ticket {
    if (numbers.length != NUMBERS_IN_TICKET) {
      throw new Error(
        `Wrong amount of numbers. Got: ${numbers.length}, expect: ${NUMBERS_IN_TICKET}`
      );
    }
    return new Ticket({
      numbers: numbers.map((number) => UInt32.from(number)),
      owner,
      amount: UInt64.from(amount),
    });
  }

  static random(owner: PublicKey): Ticket {
    return new Ticket({
      numbers: [...Array(NUMBERS_IN_TICKET)].map(() =>
        UInt32.from(getRandomInt(9) + 1)
      ),
      owner,
      amount: UInt64.from(1),
    });
  }

  check(): Bool {
    return this.numbers.reduce(
      (acc, val) => acc.and(val.lessThan(UInt32.from(10)).and(val.greaterThan(UInt32.from(0)))),
      Bool(true)
    );
  }

  hash(): Field {
    return Poseidon.hash(
      this.numbers
        .map((number) => number.value)
        .concat(this.owner.toFields())
        .concat(this.amount.value)
    );
  }

  getScore(winningCombination: UInt32[]): UInt64 {
    let result = UInt64.from(0);

    for (let i = 0; i < NUMBERS_IN_TICKET; i++) {
      result = result.add(
        Provable.if(
          winningCombination[i].equals(this.numbers[i]),
          UInt64.from(1),
          UInt64.from(0)
        )
      );
    }

    const conditions = [...Array(NUMBERS_IN_TICKET + 1)].map((val, index) =>
      result.equals(UInt64.from(index))
    );

    const values = SCORE_COEFFICIENTS.map((val) =>
      UInt64.from(val).mul(this.amount)
    );

    return Provable.switch(conditions, UInt64, values);
  }
}
