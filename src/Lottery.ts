import {
  Field,
  SmartContract,
  state,
  State,
  method,
  Struct,
  Provable,
  UInt8,
  UInt32,
  Poseidon,
  Bool,
  MerkleMapWitness,
  AccountUpdate,
  UInt64,
  Gadgets,
  Mina,
} from 'o1js';

const NUMBERS_IN_TICKET = 6;

const TICKET_PRICE = UInt64.from(10); // #TODO change to field in smartcontract
const BLOCK_PER_ROUND = 480; // Aproximate blocks per day

class Ticket extends Struct({
  numbers: Provable.Array(UInt8, NUMBERS_IN_TICKET),
  round: UInt32,
}) {
  static from(numbers: number[], round: number): Ticket {
    if (numbers.length != NUMBERS_IN_TICKET) {
      throw new Error(
        `Wrong amount of numbers. Got: ${numbers.length}, expect: ${NUMBERS_IN_TICKET}`
      );
    }
    return new Ticket({
      numbers: numbers.map((number) => UInt8.from(number)),
      round: UInt32.from(round),
    });
  }

  static generateFromSeed(seed: Field, round: UInt32): Ticket {
    const initMask = 0b1111;
    const masks = [...Array(NUMBERS_IN_TICKET)].map(
      (val, i) => initMask << (i * 4)
    );

    const numbers = masks
      .map((mask, i) => {
        const masked = Gadgets.and(seed, Field.from(mask), (i + 1) * 4);
        return Gadgets.rightShift64(masked, i * 4);
      })
      .map((val) => UInt8.from(val));

    return new Ticket({
      numbers,
      round,
    });
  }

  check(): Bool {
    return this.numbers.reduce(
      (acc, val) => acc.and(val.lessThan(10)),
      Bool(true)
    );
  }
  hash(): Field {
    return Poseidon.hash(
      this.numbers.map((number) => number.value).concat(this.round.value)
    );
  }
}

// #TODO constrain round to current

export class Lottery extends SmartContract {
  @state(Field) ticketRoot = State<Field>();
  @state(Field) ticketAmountRoot = State<Field>();
  @state(Field) roundResultRoot = State<Field>();

  init() {
    super.init();

    // #TODO Permisions
  }

  @method async buyTicket(
    ticket: Ticket,
    amount: UInt64,
    curValue: Field,
    rountWitness: MerkleMapWitness,
    ticketWitness: MerkleMapWitness
  ) {
    ticket.round.assertEquals(this.getCurrentRound());
    ticket.check().assertTrue();

    const [ticketRootBefore, key] = ticketWitness.computeRootAndKey(curValue);
    key.assertEquals(ticket.hash(), 'Wrong key for ticket witness');

    const [roundRootBefore, roundKey] =
      rountWitness.computeRootAndKey(ticketRootBefore);

    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(roundRootBefore, 'Round witness check fail');
    roundKey.assertEquals(ticket.round.value);

    const [newTicketRoot] = ticketWitness.computeRootAndKey(
      curValue.add(amount.value)
    );

    const [newRoundRoot] = rountWitness.computeRootAndKey(newTicketRoot);

    this.ticketRoot.set(newRoundRoot);

    // Get price from user
    let senderUpdate = AccountUpdate.createSigned(
      this.sender.getAndRequireSignature()
    );
    senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(amount) });
  }

  @method async produceResult(resultWiness: MerkleMapWitness) {
    // #TODO
    const [initialResultRoot, round] = resultWiness.computeRootAndKey(
      Field.from(0)
    );
    this.roundResultRoot
      .getAndRequireEquals()
      .assertEquals(initialResultRoot, 'Wrong resultWitness or value');

    round.assertGreaterThan(
      this.getCurrentRound().value,
      'Round is still not over'
    );

    Ticket.generateFromSeed(
      this.network.stakingEpochData.seed.getAndRequireEquals(), // #TODO check how often it is updated
      UInt32.fromFields([round]) // #TODO check can we do like it
    );
  }

  @method async getReward(ticketHash: Field) {
    // #TODO
  }

  public getCurrentRound(): UInt32 {
    const blockNum = this.network.blockchainLength.getAndRequireEquals();
    return blockNum.div(BLOCK_PER_ROUND);
  }
}
