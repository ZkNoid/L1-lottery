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
// technically we can remove round from ticket
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
  // Stores merkle map with all tickets, that user have bought. Each leaf of this tree is a root of tree for corresponding round
  @state(Field) ticketRoot = State<Field>();

  // Stores merkle map with total bank for each round.
  @state(Field) bankRoot = State<Field>();

  // Stores merkle map with wining combination for each rounds
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
    ticketWitness: MerkleMapWitness,
    prevBankValue: Field,
    bankWitness: MerkleMapWitness
  ) {
    // Ticket validity check
    ticket.round.assertEquals(this.getCurrentRound());
    ticket.check().assertTrue();

    // Calculate round ticket root
    const [roundTicketRootBefore, key] =
      ticketWitness.computeRootAndKey(curValue);
    key.assertEquals(ticket.hash(), 'Wrong key for ticket witness');

    // Calculate round root
    const [ticketRootBefore, roundKey] = rountWitness.computeRootAndKey(
      roundTicketRootBefore
    );

    // Check that computed ticket root is equal to contract ticketRoot.
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRootBefore, 'Round witness check fail');
    // Check that key is a ticket round
    roundKey.assertEquals(ticket.round.value);

    // Recalculate round ticket root with new value
    const [newRoundTicketRoot] = ticketWitness.computeRootAndKey(
      curValue.add(amount.value)
    );

    // Recalculate ticket root
    const [newTicketRoot] = rountWitness.computeRootAndKey(newRoundTicketRoot);

    this.ticketRoot.set(newTicketRoot);

    // Get ticket price from user
    let senderUpdate = AccountUpdate.createSigned(
      this.sender.getAndRequireSignature()
    );
    senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(amount) });

    // Update bank info
    const [prevBankRoot, bankKey] =
      bankWitness.computeRootAndKey(prevBankValue);
    this.bankRoot
      .getAndRequireEquals()
      .assertEquals(prevBankRoot, 'Wrong bank witness');
    bankKey.assertEquals(roundKey, 'Wrong bank round');

    const [newBankRoot] = bankWitness.computeRootAndKey(
      prevBankValue.add(TICKET_PRICE.mul(amount).value)
    );

    this.bankRoot.set(newBankRoot);
  }

  @method async produceResult(resultWiness: MerkleMapWitness) {
    // Check that result for this round is not computed yet, and that witness it is valid
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

    // Generate new ticket using value from blockchain
    let winningTicket = Ticket.generateFromSeed(
      this.network.stakingEpochData.seed.getAndRequireEquals(), // #TODO check how often it is updated
      UInt32.fromFields([round]) // #TODO check can we do like it
    );

    // Update result tree
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
    // Verify distibution proof
    dp.verify();

    // Calculate and check ticket root. Check that root in proof is equal to that root
    const [roundTicketRoot, ticketKey] = ticketWitness.computeRootAndKey(value);
    ticketKey.assertEquals(ticket.hash(), 'Wrong witness for ticket');
    dp.publicOutput.root.assertEquals(
      roundTicketRoot,
      'Wrong distribution proof'
    );

    // Check that ticket root is equal to ticket root on contract
    const [prevTicketRoot, round] =
      roundWitness.computeRootAndKey(roundTicketRoot);
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(
        prevTicketRoot,
        'Generated tickets root and contact ticket is not equal'
      );

    // Check that round is finished
    round.assertLessThan(
      this.getCurrentRound().value,
      'Round is still not over'
    );

    // Check result root info
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

    // Compute score using winnging ticket
    const score = ticket.getScore(
      winningTicket.numbers.map((number) => number.value)
    );

    // Pay user
    const bank = Field(0); // Change to bank info

    // bank * score / dp.publicOutput.total

    // Removed ticket from tree
  }

  public getCurrentRound(): UInt32 {
    const blockNum = this.network.blockchainLength.getAndRequireEquals();
    return blockNum.div(BLOCK_PER_ROUND);
  }
}
