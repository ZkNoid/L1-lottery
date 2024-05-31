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
  Poseidon,
  MerkleMap,
  Provable,
  Struct,
  PrivateKey,
} from 'o1js';
import { Ticket } from './Ticket.js';
import {
  BLOCK_PER_ROUND,
  COMMISION,
  NUMBERS_IN_TICKET,
  PRESICION,
  TICKET_PRICE,
} from './constants.js';
import { DistributionProof } from './DistributionProof.js';
import { PackedUInt32Factory } from './o1js-pack/Packed.js';
import { getEmpty2dMerkleMap } from './util.js';

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

const emptyMapRoot = new MerkleMap().getRoot();

const empty2dMap = getEmpty2dMerkleMap();
const empty2dMapRoot = empty2dMap.getRoot();

// !!!!!!!!!!!!!!!!!!!1 Shoud be upadted with valid address before deploying
export const { publicKey: treasury, privateKey: treasuryKey } =
  PrivateKey.randomKeypair();

export const comisionTicket = Ticket.from(
  Array(6).fill(0),
  PublicKey.empty(),
  1
);

export function getTotalScoreAndCommision(value: UInt64) {
  return value.add(value.mul(COMMISION).div(PRESICION));
}

export function getNullifierId(round: Field, ticketId: Field): Field {
  Gadgets.rangeCheck64(round);
  Gadgets.rangeCheck64(ticketId);

  return Field.fromBits([...round.toBits(64), ...ticketId.toBits(64)]);
}

// #TODO constrain round to current
// #TODO add events

export class BuyTicketEvent extends Struct({
  ticket: Ticket,
  round: Field,
}) {}

export class ProduceResultEvent extends Struct({
  result: Field,
  round: Field,
}) {}

export class GetRewardEvent extends Struct({
  ticket: Ticket,
  round: Field,
}) {}

export class RefundEvent extends Struct({
  ticket: Ticket,
  round: Field,
}) {}

export class Lottery extends SmartContract {
  events = {
    'buy-ticket': BuyTicketEvent,
    'produce-result': ProduceResultEvent,
    'get-reward': GetRewardEvent,
    'get-refund': RefundEvent,
  };
  // Stores merkle map with all tickets, that user have bought. Each leaf of this tree is a root of tree for corresponding round
  @state(Field) ticketRoot = State<Field>();

  // #TODO rework nullifier. For now you can create ticket, that will fail nullifier check. Also it is too heavy
  @state(Field) ticketNullifier = State<Field>();

  // Stores merkle map with total bank for each round.
  @state(Field) bankRoot = State<Field>();

  // Stores merkle map with wining combination for each rounds
  @state(Field) roundResultRoot = State<Field>();

  // Stores block of deploy
  @state(UInt32) startBlock = State<UInt32>();

  init() {
    super.init();

    this.ticketRoot.set(empty2dMapRoot); // Redoo, becase leafs is not 0, but empty map root
    this.ticketNullifier.set(emptyMapRoot);
    this.bankRoot.set(emptyMapRoot);
    this.roundResultRoot.set(emptyMapRoot);

    this.startBlock.set(this.network.blockchainLength.getAndRequireEquals());

    // #TODO Permisions
  }

  @method async buyTicket(
    ticket: Ticket,
    roundWitness: MerkleMapWitness,
    roundTicketWitness: MerkleMapWitness,
    prevBankValue: Field,
    bankWitness: MerkleMapWitness
  ) {
    ticket.owner.equals(this.sender.getAndRequireSignature()); // Do we need this check?

    // Ticket validity check
    ticket.check().assertTrue();

    // Calculate round ticket root
    const [roundTicketRootBefore, key] = roundTicketWitness.computeRootAndKey(
      Field(0) // Because ticket should be empty before buying
    );
    key.assertGreaterThan(Field(0), '0 slot is reserved for comission ticket');
    // Key can be any right now. We can change it to
    // key.assertEquals(ticket.hash(), 'Wrong key for ticket witness');

    // Calculate round root
    const [ticketRootBefore, roundKey] = roundWitness.computeRootAndKey(
      roundTicketRootBefore
    );

    // Check that computed ticket root is equal to contract ticketRoot.
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRootBefore, 'Round witness check fail');
    // Check that key is a ticket round
    roundKey.assertEquals(this.getCurrentRound().value);

    // Recalculate round ticket root with new value
    const [newRoundTicketRoot] = roundTicketWitness.computeRootAndKey(
      ticket.hash()
    );

    // Recalculate ticket root
    const [newTicketRoot] = roundWitness.computeRootAndKey(newRoundTicketRoot);

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

    this.emitEvent(
      'buy-ticket',
      new BuyTicketEvent({
        ticket,
        round: roundKey,
      })
    );
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
    let winningNumbers = this.getWiningNumbersForRound();

    let newLeafValue = NumberPacked.pack(winningNumbers);

    // Update result tree
    const [newResultRoot] = resultWiness.computeRootAndKey(newLeafValue);

    this.roundResultRoot.set(newResultRoot);

    this.emitEvent(
      'produce-result',
      new ProduceResultEvent({
        result: newLeafValue,
        round,
      })
    );
  }

  @method async refund(
    ticket: Ticket,
    roundWitness: MerkleMapWitness,
    roundTicketWitness: MerkleMapWitness,
    resultWitness: MerkleMapWitness,
    bankValue: Field,
    bankWitness: MerkleMapWitness,
    nullieiferWitness: MerkleMapWitness
  ) {
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());

    // Check ticket in merkle map
    const [roundTicketRoot, ticketKey] = roundTicketWitness.computeRootAndKey(
      ticket.hash()
    );

    const [prevTicketRoot, round] =
      roundWitness.computeRootAndKey(roundTicketRoot);

    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(
        prevTicketRoot,
        'Generated tickets root and contact ticket is not equal'
      );

    // Check that result is zero for this round
    const [resultRoot, resultRound] = resultWitness.computeRootAndKey(Field(0));
    this.roundResultRoot
      .getAndRequireEquals()
      .assertEquals(resultRoot, 'Wrong result witness');
    round.assertEquals(resultRound, 'Wrong result round');

    // Can call refund after ~ 2 days after round finished
    const curRound = this.getCurrentRound();
    curRound.assertGreaterThan(
      UInt32.fromFields([round.add(2)]),
      'To early for refund'
    );

    // Check bank witness
    const [prevBankRoot, bankKey] = bankWitness.computeRootAndKey(bankValue);
    this.bankRoot
      .getAndRequireEquals()
      .assertEquals(prevBankRoot, 'Wrong bank witness');
    bankKey.assertEquals(round, 'Wrong bank round');

    // Check that ticket has not been used before
    const [prevNullifierRoot, nullifierKey] =
      nullieiferWitness.computeRootAndKey(Field(0));

    this.ticketNullifier
      .getAndRequireEquals()
      .assertEquals(prevNullifierRoot, 'Wrong nullifier witness');
    nullifierKey.assertEquals(
      getNullifierId(round, ticketKey),
      'Wrong nullifier witness key'
    );

    // Update nullifier
    const [newNullifierValue] = nullieiferWitness.computeRootAndKey(
      Field.from(1)
    );

    this.ticketNullifier.set(newNullifierValue);

    // Update bank for round
    const totalTicketPrice = ticket.amount.mul(TICKET_PRICE);
    const [newBankRoot] = bankWitness.computeRootAndKey(
      bankValue.sub(totalTicketPrice.value)
    );

    this.bankRoot.set(newBankRoot);

    // Send ticket price back to user
    this.send({
      to: ticket.owner,
      amount: totalTicketPrice,
    });

    this.emitEvent(
      'get-refund',
      new RefundEvent({
        ticket,
        round,
      })
    );
  }

  @method async getReward(
    ticket: Ticket,
    roundWitness: MerkleMapWitness,
    roundTicketWitness: MerkleMapWitness,
    dp: DistributionProof,
    winningNumbers: Field,
    resutWitness: MerkleMapWitness,
    bankValue: Field,
    bankWitness: MerkleMapWitness,
    nullieiferWitness: MerkleMapWitness
  ) {
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());
    // Verify distibution proof
    dp.verify();

    // Calculate and check ticket root. Check that root in proof is equal to that root
    const [roundTicketRoot, ticketKey] = roundTicketWitness.computeRootAndKey(
      ticket.hash()
    );
    // ticketKey.assertEquals(ticket.hash(), 'Wrong witness for ticket');
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
    const score = ticket.getScore(NumberPacked.unpack(winningNumbers));
    const totalScore = getTotalScoreAndCommision(dp.publicOutput.total);

    // Pay user
    const [bankRoot, bankKey] = bankWitness.computeRootAndKey(bankValue);
    this.bankRoot
      .getAndRequireEquals()
      .assertEquals(bankRoot, 'Wrong bank root witness');
    bankKey.assertEquals(round, 'Wrong bank round');

    this.send({
      to: ticket.owner,
      amount: UInt64.fromFields([bankValue]).mul(score).div(totalScore),
    });

    // Add ticket to nullifier

    const [prevNullifierRoot, nullifierKey] =
      nullieiferWitness.computeRootAndKey(Field(0));

    this.ticketNullifier
      .getAndRequireEquals()
      .assertEquals(prevNullifierRoot, 'Wrong nullifier witness');
    nullifierKey.assertEquals(
      getNullifierId(round, ticketKey),
      'Wrong nullifier witness key'
    );

    const [newNullifierValue] = nullieiferWitness.computeRootAndKey(
      Field.from(1)
    );

    this.ticketNullifier.set(newNullifierValue);
    this.emitEvent(
      'get-reward',
      new GetRewardEvent({
        ticket,
        round,
      })
    );
  }

  @method async getCommisionForRound(
    ticketWitness: MerkleMapWitness,
    result: Field,
    resultWitness: MerkleMapWitness,
    dp: DistributionProof,
    bankValue: Field,
    bankWitness: MerkleMapWitness,
    nullifierWitness: MerkleMapWitness
  ): Promise<void> {
    this.sender.getAndRequireSignature().assertEquals(treasury);

    const [resultRoot, round] = resultWitness.computeRootAndKey(result);
    this.roundResultRoot
      .getAndRequireEquals()
      .assertEquals(resultRoot, 'Wrong resultRoot');

    const [bankRoot, bankRound] = resultWitness.computeRootAndKey(bankValue);
    this.bankRoot
      .getAndRequireEquals()
      .assertEquals(bankRoot, 'Wrong bank root');
    round.assertEquals(bankRound, 'Bank round != result round');

    const [nullifierRoot, nullifierkKey] = nullifierWitness.computeRootAndKey(
      Field(0)
    );
    this.ticketNullifier
      .getAndRequireEquals()
      .assertEquals(nullifierRoot, 'Wrong nullifier root');
    nullifierkKey.assertEquals(getNullifierId(round, Field(0)));

    // Send commision
    dp.verify();

    const [ticketRoot, ticketKey] = ticketWitness.computeRootAndKey(
      dp.publicOutput.root
    );
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRoot, 'Wrong ticket root');
    ticketKey.assertEquals(round, 'Wrong ticket round');

    const totalScore = getTotalScoreAndCommision(dp.publicOutput.total);

    this.send({
      to: treasury,
      amount: totalScore.sub(dp.publicOutput.total),
    });

    // Upadte nullifier

    const [newNulifierRoot] = nullifierWitness.computeRootAndKey(Field(1));

    this.ticketNullifier.set(newNulifierRoot);
  }

  public getCurrentRound(): UInt32 {
    const startBlock = this.startBlock.getAndRequireEquals();
    const blockNum = this.network.blockchainLength.getAndRequireEquals();
    return blockNum.sub(startBlock).div(BLOCK_PER_ROUND);
  }

  public getWiningNumbersForRound(): UInt32[] {
    // Temporary function implementation. Later will be switch with oracle call.
    return generateNumbersSeed(Field(12345));
  }
}

export const mockWinningCombination = [1, 1, 1, 1, 1, 1];

export class MockLottery extends Lottery {
  override getWiningNumbersForRound(): UInt32[] {
    return mockWinningCombination.map((val) => UInt32.from(val));
  }
}
