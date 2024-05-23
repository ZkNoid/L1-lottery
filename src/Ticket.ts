import {
  Field,
  Struct,
  Provable,
  UInt8,
  UInt32,
  Poseidon,
  Bool,
  Gadgets,
  PublicKey,
  UInt64,
} from 'o1js';
import { NUMBERS_IN_TICKET, SCORE_COEFFICIENTS } from './constants';

// #TODO add user address to ticket
// technically we can remove round from ticket
export class Ticket extends Struct({
  numbers: Provable.Array(UInt8, NUMBERS_IN_TICKET),
  owner: PublicKey,
  amount: UInt64,
}) {
  static from(numbers: number[], owner: PublicKey, amount: number): Ticket {
    if (numbers.length != NUMBERS_IN_TICKET) {
      throw new Error(
        `Wrong amount of numbers. Got: ${numbers.length}, expect: ${NUMBERS_IN_TICKET}`
      );
    }
    return new Ticket({
      numbers: numbers.map((number) => UInt8.from(number)),
      owner,
      amount: UInt64.from(amount),
    });
  }

  // static generateFromSeed(seed: Field, round: UInt32): Ticket {
  //   const initMask = 0b1111;
  //   const masks = [...Array(NUMBERS_IN_TICKET)].map(
  //     (val, i) => initMask << (i * 4)
  //   );

  //   const numbers = masks
  //     .map((mask, i) => {
  //       const masked = Gadgets.and(seed, Field.from(mask), (i + 1) * 4);
  //       return Gadgets.rightShift64(masked, i * 4);
  //     })
  //     .map((val) => UInt8.from(val));

  //   return new Ticket({
  //     numbers,
  //     round,
  //   });
  // }

  check(): Bool {
    return this.numbers.reduce(
      (acc, val) => acc.and(val.lessThan(10)),
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

  getScore(winningCombination: Field[]): Field {
    let result = Field.from(0);

    for (let i = 0; i < NUMBERS_IN_TICKET; i++) {
      result = result.add(
        Provable.if(
          winningCombination[i].equals(this.numbers[i].value),
          Field.from(1),
          Field.from(0)
        )
      );
    }

    const conditions = [...Array(NUMBERS_IN_TICKET)].map((val, index) =>
      result.equals(index)
    );

    const values = SCORE_COEFFICIENTS.map((val) =>
      Field.from(val).mul(this.amount.value)
    );

    return Provable.switch(conditions, Field, values);
  }
}
