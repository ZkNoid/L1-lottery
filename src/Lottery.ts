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
  ZkProgram,
  MerkleMap,
  SelfProof,
} from 'o1js';

const NUMBERS_IN_TICKET = 6;

const TICKET_PRICE = UInt64.from(10); // #TODO change to field in smartcontract
const BLOCK_PER_ROUND = 480; // Aproximate blocks per day

// #TODO add user address to ticket
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

    const values = [0, 10, 100, 1000, 10000, 100000].map((val) =>
      Field.from(val)
    );

    return Provable.switch(conditions, Field, values);
  }
}

export class DistributionProofPublicInput extends Struct({
  winingCombination: Provable.Array(Field, NUMBERS_IN_TICKET),
  ticket: Ticket,
  oldValue: Field,
  valueWitness: MerkleMapWitness,
  valueDiff: Field,
}) {}

export class DistributionProofPublicOutput extends Struct({
  root: Field,
  total: Field,
}) {}

const emptyMap = new MerkleMap();
const emptyMapRoot = emptyMap.getRoot();

const DistibutionProgram = ZkProgram({
  name: 'distribution-program',
  publicInput: DistributionProofPublicInput,
  publicOutput: DistributionProofPublicOutput,
  methods: {
    init: {
      privateInputs: [],
      async method(): Promise<DistributionProofPublicOutput> {
        return new DistributionProofPublicOutput({
          root: emptyMapRoot,
          total: Field.from(0),
        });
      },
    },
    addTicket: {
      privateInputs: [SelfProof],
      async method(
        input: DistributionProofPublicInput,
        prevProof: SelfProof<
          DistributionProofPublicInput,
          DistributionProofPublicOutput
        >
      ) {
        input.valueDiff.assertGreaterThan(
          Field.from(0),
          'valueDiff should be > 0'
        );
        prevProof.verify();

        const [initialRoot, key] = input.valueWitness.computeRootAndKey(
          input.oldValue
        );
        key.assertEquals(input.ticket.hash(), 'Wrong key for that ticket');
        initialRoot.assertEquals(prevProof.publicOutput.root);

        const newValue = input.oldValue.add(input.valueDiff);

        const [newRoot] = input.valueWitness.computeRootAndKey(newValue);
        const ticketScore = input.ticket
          .getScore(input.winingCombination)
          .mul(input.valueDiff);

        return new DistributionProofPublicOutput({
          root: newRoot,
          total: prevProof.publicOutput.total.add(ticketScore),
        });
      },
    },
  },
});

export class DistributionProof extends ZkProgram.Proof(DistibutionProgram) {}

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

    round.assertLessThan(
      this.getCurrentRound().value,
      'Round is still not over'
    );

    let winningTicket = Ticket.generateFromSeed(
      this.network.stakingEpochData.seed.getAndRequireEquals(), // #TODO check how often it is updated
      UInt32.fromFields([round]) // #TODO check can we do like it
    );

    const [newResultRoot] = resultWiness.computeRootAndKey(
      winningTicket.hash()
    );

    this.roundResultRoot.set(newResultRoot);
  }

  @method async getReward(
    ticket: Ticket,
    value: Field,
    roundWitness: MerkleMapWitness,
    ticketWitness: MerkleMapWitness,
    dp: DistributionProof,
    winningTicket: Ticket, // We do not need ticket here, we can zipp numbers in field. But for simplicity we will use ticket for now
    resutWitness: MerkleMapWitness
  ) {
    dp.verify();

    const [ticketRoot, ticketKey] = ticketWitness.computeRootAndKey(value);
    ticketKey.assertEquals(ticket.hash(), 'Wrong witness for ticket');
    dp.publicOutput.root.assertEquals(ticketRoot, 'Wrong distribution proof');

    const [roundRoot, round] = roundWitness.computeRootAndKey(ticketRoot);
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(
        roundRoot,
        'Generated tickets root and contact ticket is not equal'
      );

    round.assertLessThan(
      this.getCurrentRound().value,
      'Round is still not over'
    );

    const [resultRoot, resultRound] = resutWitness.computeRootAndKey(
      winningTicket.hash()
    );
    resultRound.assertEquals(
      round,
      'Winning ticket and your ticket is from different rounds'
    );
    this.roundResultRoot
      .getAndRequireEquals()
      .assertEquals(resultRoot, 'Wrong result witness');

    const score = ticket.getScore(
      winningTicket.numbers.map((number) => number.value)
    );

    // #TODO
  }

  public getCurrentRound(): UInt32 {
    const blockNum = this.network.blockchainLength.getAndRequireEquals();
    return blockNum.div(BLOCK_PER_ROUND);
  }
}
