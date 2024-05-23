import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMapWitness,
  AccountUpdate,
  UInt64,
  Gadgets,
  UInt8,
  Int64,
  PublicKey,
  CircuitString,
} from 'o1js';
import { PackedUInt32Factory } from 'o1js-pack';
import { Ticket } from './Ticket';
import { BLOCK_PER_ROUND, NUMBERS_IN_TICKET, TICKET_PRICE } from './constants';
import { DistributionProof } from './DistributionProof';

export class NumberPacked extends PackedUInt32Factory() {}

const generateNumbersSeed = (seed: Field): UInt32[] => {
  const initMask = 0b1111;
  const masks = [...Array(NUMBERS_IN_TICKET)].map(
    (val, i) => initMask << (i * 4)
  );

  const numbers = masks
    .map((mask, i) => {
      const masked = Gadgets.and(seed, Field.from(mask), (i + 1) * 4);
      return Gadgets.rightShift64(masked, i * 4);
    })
    .map((val) => UInt32.fromFields([val])); // #TODO can we use fromFields here?

  return numbers;
};

// #TODO constrain round to current
// #TODO add events

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
    rountWitness: MerkleMapWitness,
    ticketWitness: MerkleMapWitness,
    prevBankValue: Field,
    bankWitness: MerkleMapWitness
  ) {
    ticket.owner.equals(this.sender.getAndRequireSignature()); // Do we need this check?

    // Ticket validity check
    ticket.check().assertTrue();

    // Calculate round ticket root
    const [roundTicketRootBefore, key] = ticketWitness.computeRootAndKey(
      Field(0) // Because ticket should be empty before buying
    );
    // Key can be any right now. We can change it to
    // key.assertEquals(ticket.hash(), 'Wrong key for ticket witness');

    // Calculate round root
    const [ticketRootBefore, roundKey] = rountWitness.computeRootAndKey(
      roundTicketRootBefore
    );

    // Check that computed ticket root is equal to contract ticketRoot.
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRootBefore, 'Round witness check fail');
    // Check that key is a ticket round
    roundKey.assertEquals(this.getCurrentRound().value);

    // Recalculate round ticket root with new value
    const [newRoundTicketRoot] = ticketWitness.computeRootAndKey(ticket.hash());

    // Recalculate ticket root
    const [newTicketRoot] = rountWitness.computeRootAndKey(newRoundTicketRoot);

    this.ticketRoot.set(newTicketRoot);

    // Get ticket price from user
    let senderUpdate = AccountUpdate.createSigned(
      this.sender.getAndRequireSignature()
    );
    senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(ticket.amount) });

    // Update bank info
    const [prevBankRoot, bankKey] =
      bankWitness.computeRootAndKey(prevBankValue);
    this.bankRoot
      .getAndRequireEquals()
      .assertEquals(prevBankRoot, 'Wrong bank witness');
    bankKey.assertEquals(roundKey, 'Wrong bank round');

    const [newBankRoot] = bankWitness.computeRootAndKey(
      prevBankValue.add(TICKET_PRICE.mul(ticket.amount).value)
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
    let winningNumbers = generateNumbersSeed(
      this.network.stakingEpochData.seed.getAndRequireEquals() // Probably not secure as seed is not updating quite often
    );

    let newLeafValue = NumberPacked.pack(winningNumbers);

    // Update result tree
    const [newResultRoot] = resultWiness.computeRootAndKey(newLeafValue);

    this.roundResultRoot.set(newResultRoot);
  }

  @method async getReward(
    ticket: Ticket,
    value: Field,
    roundWitness: MerkleMapWitness,
    ticketWitness: MerkleMapWitness,
    dp: DistributionProof,
    winningNumbers: Field,
    resutWitness: MerkleMapWitness
  ) {
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());
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
    const [resultRoot, resultRound] =
      resutWitness.computeRootAndKey(winningNumbers);
    resultRound.assertEquals(
      round,
      'Winning ticket and your ticket is from different rounds'
    );
    this.roundResultRoot
      .getAndRequireEquals()
      .assertEquals(resultRoot, 'Wrong result witness');

    // Compute score using winnging ticket
    const score = ticket.getScore(
      NumberPacked.unpack(winningNumbers).map((number) => number.value)
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
