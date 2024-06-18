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
import { NumberPacked, getEmpty2dMerkleMap } from './util.js';
import { MerkleMap20, MerkleMap20Witness } from './CustomMerkleMap.js';

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
const emptyMap20Root = new MerkleMap20().getRoot();

const empty2dMap = getEmpty2dMerkleMap(20);
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
    this.bankRoot.set(emptyMap20Root);
    this.roundResultRoot.set(emptyMap20Root);

    this.startBlock.set(this.network.blockchainLength.getAndRequireEquals());

    // #TODO Permisions
  }

  @method async buyTicket(
    ticket: Ticket,
    roundWitness: MerkleMap20Witness,
    roundTicketWitness: MerkleMap20Witness,
    prevBankValue: Field,
    bankWitness: MerkleMap20Witness
  ) {
    ticket.owner.equals(this.sender.getAndRequireSignature()); // Do we need this check?

    // Ticket validity check
    ticket.check().assertTrue();

    const round = this.getCurrentRound().value;
    const { ticketId } = this.checkAndUpdateTicketMap(
      roundWitness,
      round,
      roundTicketWitness,
      Field(0),
      ticket.hash()
    );

    ticketId.assertGreaterThan(Field(0), 'Zero ticket - commision ticket');

    // Get ticket price from user
    let senderUpdate = AccountUpdate.createSigned(
      this.sender.getAndRequireSignature()
    );
    senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(ticket.amount) });

    const newBankValue = prevBankValue.add(
      TICKET_PRICE.mul(ticket.amount).value
    );
    this.checkAndUpdateBank(bankWitness, round, prevBankValue, newBankValue);

    this.emitEvent(
      'buy-ticket',
      new BuyTicketEvent({
        ticket,
        round: round,
      })
    );
  }

  @method async produceResult(resultWiness: MerkleMap20Witness) {
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
    round: Field,
    roundWitness: MerkleMap20Witness,
    roundTicketWitness: MerkleMap20Witness,
    resultWitness: MerkleMap20Witness,
    bankValue: Field,
    bankWitness: MerkleMap20Witness,
    nullifierWitness: MerkleMapWitness
  ) {
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());

    // Check ticket in merkle map

    const { ticketId } = this.checkTicket(
      roundWitness,
      round,
      roundTicketWitness,
      ticket.hash()
    );

    // Check that result is zero for this round
    this.checkResult(resultWitness, round, Field(0));

    // Can call refund after ~ 2 days after round finished
    const curRound = this.getCurrentRound();
    curRound.assertGreaterThan(
      UInt32.fromFields([round.add(2)]),
      'To early for refund'
    );

    // Check and update bank witness
    const totalTicketPrice = ticket.amount.mul(TICKET_PRICE);
    const newBankValue = bankValue.sub(totalTicketPrice.value);
    this.checkAndUpdateBank(bankWitness, round, bankValue, newBankValue);

    this.checkAndUpdateNullifier(
      nullifierWitness,
      getNullifierId(round, ticketId),
      Field(0),
      Field.from(1)
    );

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
    round: Field,
    roundWitness: MerkleMap20Witness,
    roundTicketWitness: MerkleMap20Witness,
    dp: DistributionProof,
    winningNumbers: Field,
    resutWitness: MerkleMap20Witness,
    bankValue: Field,
    bankWitness: MerkleMap20Witness,
    nullifierWitness: MerkleMapWitness
  ) {
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());
    // Verify distibution proof
    dp.verify();

    const { ticketId, roundRoot: roundTicketRoot } = this.checkTicket(
      roundWitness,
      round,
      roundTicketWitness,
      ticket.hash()
    );

    dp.publicOutput.root.assertEquals(
      roundTicketRoot,
      'Wrong distribution proof'
    );

    // Check result root info
    this.checkResult(resutWitness, round, winningNumbers);

    // Compute score using winnging ticket
    const score = ticket.getScore(NumberPacked.unpack(winningNumbers));
    const totalScore = getTotalScoreAndCommision(dp.publicOutput.total);

    // Pay user
    this.checkBank(bankWitness, round, bankValue);

    this.send({
      to: ticket.owner,
      amount: UInt64.fromFields([bankValue]).mul(score).div(totalScore),
    });

    // Add ticket to nullifier

    this.checkAndUpdateNullifier(
      nullifierWitness,
      getNullifierId(round, ticketId),
      Field(0),
      Field.from(1)
    );

    this.emitEvent(
      'get-reward',
      new GetRewardEvent({
        ticket,
        round,
      })
    );
  }

  @method async getCommisionForRound(
    ticketWitness: MerkleMap20Witness,
    result: Field,
    round: Field,
    resultWitness: MerkleMap20Witness,
    dp: DistributionProof,
    bankValue: Field,
    bankWitness: MerkleMap20Witness,
    nullifierWitness: MerkleMapWitness
  ): Promise<void> {
    this.sender.getAndRequireSignature().assertEquals(treasury);

    this.checkResult(resultWitness, round, result);

    this.checkBank(bankWitness, round, bankValue);

    this.checkAndUpdateNullifier(
      nullifierWitness,
      getNullifierId(round, Field(0)),
      Field(0),
      Field.from(1)
    );

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

  private checkResult(
    witness: MerkleMap20Witness,
    round: Field,
    curValue: Field
  ) {
    this.checkMap(this.roundResultRoot, witness, round, curValue);
  }

  private checkAndUpdateResult(
    witness: MerkleMap20Witness,
    round: Field,
    curValue: Field,
    newValue: Field
  ) {
    this.checkAndUpdateMap(
      this.roundResultRoot,
      witness,
      round,
      curValue,
      newValue
    );
  }

  private checkBank(
    witness: MerkleMap20Witness,
    round: Field,
    curValue: Field
  ) {
    this.checkMap(this.bankRoot, witness, round, curValue);
  }

  private checkAndUpdateBank(
    witness: MerkleMap20Witness,
    round: Field,
    curValue: Field,
    newValue: Field
  ) {
    this.checkAndUpdateMap(this.bankRoot, witness, round, curValue, newValue);
  }

  private checkAndUpdateNullifier(
    witness: MerkleMapWitness,
    key: Field,
    curValue: Field,
    newValue: Field
  ) {
    this.checkAndUpdateMap(
      this.ticketNullifier,
      witness,
      key,
      curValue,
      newValue
    );
  }

  private checkAndUpdateMap(
    state: State<Field>,
    witness: MerkleMap20Witness | MerkleMapWitness,
    key: Field,
    curValue: Field,
    newValue: Field
  ) {
    this.checkMap(state, witness, key, curValue);

    const [newRoot] = witness.computeRootAndKey(newValue);
    state.set(newRoot);
  }

  private checkMap(
    state: State<Field>,
    witness: MerkleMap20Witness | MerkleMapWitness,
    key: Field,
    curValue: Field
  ) {
    const curRoot = state.getAndRequireEquals();

    const [prevRoot, witnessKey] = witness.computeRootAndKey(curValue);
    curRoot.assertEquals(prevRoot, 'Wrong witness');
    witnessKey.assertEquals(key, 'Wrong key');
  }

  private checkAndUpdateTicketMap(
    firstWitness: MerkleMap20Witness | MerkleMapWitness,
    key1: Field,
    secondWitness: MerkleMap20Witness | MerkleMapWitness,
    // key2: Field, For know second level key is not checked as later it would transform to merkle map
    prevValue: Field,
    newValue: Field
  ): { ticketId: Field } {
    const res = this.checkTicket(firstWitness, key1, secondWitness, prevValue);

    const [newRoot2] = secondWitness.computeRootAndKey(newValue);
    const [newRoot1] = firstWitness.computeRootAndKey(newRoot2);
    this.ticketRoot.set(newRoot1);

    return res;
  }

  private checkTicket(
    firstWitness: MerkleMap20Witness | MerkleMapWitness,
    key1: Field,
    secondWitness: MerkleMap20Witness | MerkleMapWitness,
    // key2: Field, For know second level key is not checked as later it would transform to merkle map
    value: Field
  ): { ticketId: Field; roundRoot: Field } {
    const [secondLevelRoot, ticketId] = secondWitness.computeRootAndKey(value);

    const [firstLevelRoot, firstLevelKey] =
      firstWitness.computeRootAndKey(secondLevelRoot);

    firstLevelKey.assertEquals(key1, 'Wrong first level key');
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(firstLevelRoot, 'Wrong 2d witness');

    return { ticketId, roundRoot: secondLevelRoot };
  }
}

export const mockWinningCombination = [1, 1, 1, 1, 1, 1];

export class MockLottery extends Lottery {
  override getWiningNumbersForRound(): UInt32[] {
    return mockWinningCombination.map((val) => UInt32.from(val));
  }
}
