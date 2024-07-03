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
  Reducer,
} from 'o1js';
import { Ticket } from './Ticket.js';
import {
  BLOCK_PER_ROUND,
  COMMISION,
  NUMBERS_IN_TICKET,
  PRESICION,
  TICKET_PRICE,
  mockWinningCombination,
} from './constants.js';
import { DistributionProof } from './DistributionProof.js';
import {
  NumberPacked,
  getEmpty2dMerkleMap,
  getNullifierId,
  getTotalScoreAndCommision,
} from './util.js';
import { MerkleMap20, MerkleMap20Witness } from './CustomMerkleMap.js';

export interface MerkleCheckResult {
  key: Field;
}

export const mockResult = NumberPacked.pack(
  mockWinningCombination.map((v) => UInt32.from(v))
);

const treasury = PublicKey.fromBase58(
  'B62qj3DYVUCaTrDnFXkJW34xHUBr9zUorg72pYN3BJTGB4KFdpYjxxQ'
);
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
// export const { publicKey: treasury, privateKey: treasuryKey } =
//   PrivateKey.randomKeypair();
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

export class LotteryAction extends Struct({
  ticket: Ticket,
  round: Field,
}) {}

// Parallel lottery
export class PLottery extends SmartContract {
  reducer = Reducer({ actionType: LotteryAction });

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

  @state(Field) lastProcessedState = State<Field>();

  init() {
    super.init();

    this.ticketRoot.set(empty2dMapRoot); // Redoo, becase leafs is not 0, but empty map root
    this.ticketNullifier.set(emptyMapRoot);
    this.bankRoot.set(emptyMap20Root);
    this.roundResultRoot.set(emptyMap20Root);

    this.startBlock.set(
      this.network.globalSlotSinceGenesis.getAndRequireEquals()
    );

    // #TODO Permisions
  }

  @method async buyTicket(ticket: Ticket, round: Field) {
    ticket.owner.equals(this.sender.getAndRequireSignature()); // Do we need this check?
    // Ticket validity check
    ticket.check().assertTrue();
    this.checkCurrentRound(UInt32.fromFields([round]));

    // Get ticket price from user
    let senderUpdate = AccountUpdate.createSigned(
      this.sender.getAndRequireSignature()
    );

    senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(ticket.amount) });

    this.reducer.dispatch(
      new LotteryAction({
        ticket,
        round,
      })
    );

    this.emitEvent(
      'buy-ticket',
      new BuyTicketEvent({
        ticket,
        round: round,
      })
    );
  }

  @method async reduceTickets(reduceProof: TicketReduceProof) {
    reduceProof.verify();
    let lastProcessedState = this.lastProcessedState.getAndRequireEquals();
    let actionState = this.account.actionState.getAndRequireEquals();

    // Check that state on contract is equal to state on proof
    lastProcessedState.assertEquals(
      reduceProof.publicInput.initialState,
      'Initial state is not match contract last processed state'
    );

    // Check that actionState is equal to actionState on proof
    actionState.assertEquals(
      reduceProof.publicOutput.finalState,
      'Final state is not match contract actionState'
    );

    this.ticketRoot.set(reduceProof.publicOutput.newTicketRoot);
    this.bankRoot.set(reduceProof.publicOutput.newBankRoot);
  }

  @method async produceResult(resultWiness: MerkleMap20Witness, result: Field) {
    // Check that result for this round is not computed yet, and that witness it is valid
    const [initialResultRoot, round] = resultWiness.computeRootAndKey(
      Field.from(0)
    );

    this.roundResultRoot
      .getAndRequireEquals()
      .assertEquals(initialResultRoot, 'Wrong resultWitness or value');

    this.checkRoundPass(UInt32.fromFields([round]));

    // Generate new ticket using value from blockchain
    let winningNumbers = this.getWiningNumbersForRound();

    // let newLeafValue = NumberPacked.pack(winningNumbers);
    let newLeafValue = result; // For test purpose

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
    roundWitness: MerkleMap20Witness,
    roundTicketWitness: MerkleMap20Witness,
    resultWitness: MerkleMap20Witness,
    bankValue: Field,
    bankWitness: MerkleMap20Witness,
    nullifierWitness: MerkleMapWitness
  ) {
    // Check taht owner trying to claim
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());

    // Check ticket in merkle map
    const { ticketId, round } = this.checkTicket(
      roundWitness,
      null,
      roundTicketWitness,
      ticket.hash()
    );

    // Check that result is zero for this round
    this.checkResult(resultWitness, round, Field(0));

    // Can call refund after ~ 2 days after round finished
    this.checkRoundPass(UInt32.fromFields([round.add(2)]));

    // Check and update bank witness
    const totalTicketPrice = ticket.amount.mul(TICKET_PRICE);
    const newBankValue = bankValue.sub(totalTicketPrice.value);
    this.checkAndUpdateBank(bankWitness, round, bankValue, newBankValue);

    // Check and update nullifier
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
    roundWitness: MerkleMap20Witness,
    roundTicketWitness: MerkleMap20Witness,
    dp: DistributionProof,
    winningNumbers: Field,
    resutWitness: MerkleMap20Witness,
    bankValue: Field,
    bankWitness: MerkleMap20Witness,
    nullifierWitness: MerkleMapWitness
  ) {
    // Check taht owner trying to claim
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());
    // Verify distibution proof
    dp.verify();

    // Check ticket in tree
    const {
      ticketId,
      roundRoot: roundTicketRoot,
      round,
    } = this.checkTicket(roundWitness, null, roundTicketWitness, ticket.hash());

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
    resultWitness: MerkleMap20Witness,
    dp: DistributionProof,
    bankValue: Field,
    bankWitness: MerkleMap20Witness,
    nullifierWitness: MerkleMapWitness
  ): Promise<void> {
    dp.verify();

    // Only treasury account can claim commision
    this.sender.getAndRequireSignature().assertEquals(treasury);

    // Check result for round is right
    const { key: round } = this.checkResult(resultWitness, null, result);

    // Check bank value for round
    this.checkBank(bankWitness, round, bankValue);

    // Update nullifier for ticket
    this.checkAndUpdateNullifier(
      nullifierWitness,
      getNullifierId(round, Field(0)),
      Field(0),
      Field.from(1)
    );

    // Check ticket
    const [ticketRoot, ticketKey] = ticketWitness.computeRootAndKey(
      dp.publicOutput.root
    );
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRoot, 'Wrong ticket root');
    ticketKey.assertEquals(round, 'Wrong ticket round');

    // Send commision to treasury
    const totalScore = getTotalScoreAndCommision(dp.publicOutput.total);

    this.send({
      to: treasury,
      amount: totalScore.sub(dp.publicOutput.total),
    });
  }

  // public getCurrentRound(): UInt32 {
  //   const startBlock = this.startBlock.getAndRequireEquals();
  //   const blockNum = this.network.globalSlotSinceGenesis.getAndRequireEquals();
  //   return blockNum.sub(startBlock).div(BLOCK_PER_ROUND);
  // }

  public checkCurrentRound(round: UInt32) {
    const startBlock = this.startBlock.getAndRequireEquals();
    this.network.globalSlotSinceGenesis.requireBetween(
      startBlock.add(round.mul(BLOCK_PER_ROUND)),
      startBlock.add(round.add(1).mul(BLOCK_PER_ROUND))
    );
  }

  public checkRoundPass(round: UInt32) {
    const startBlock = this.startBlock.getAndRequireEquals();
    this.network.globalSlotSinceGenesis.requireBetween(
      startBlock.add(round.mul(BLOCK_PER_ROUND)),
      UInt32.MAXINT()
    );
  }

  public getWiningNumbersForRound(): UInt32[] {
    return mockWinningCombination.map((val) => UInt32.from(val));
    // // Temporary function implementation. Later will be switch with oracle call.
    // return generateNumbersSeed(Field(12345));
  }

  private checkResult(
    witness: MerkleMap20Witness,
    round: Field | null,
    curValue: Field
  ): MerkleCheckResult {
    return this.checkMap(this.roundResultRoot, witness, round, curValue);
  }

  private checkAndUpdateResult(
    witness: MerkleMap20Witness,
    round: Field,
    curValue: Field,
    newValue: Field
  ): MerkleCheckResult {
    return this.checkAndUpdateMap(
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
  ): MerkleCheckResult {
    return this.checkMap(this.bankRoot, witness, round, curValue);
  }

  private checkAndUpdateBank(
    witness: MerkleMap20Witness,
    round: Field,
    curValue: Field,
    newValue: Field
  ): MerkleCheckResult {
    return this.checkAndUpdateMap(
      this.bankRoot,
      witness,
      round,
      curValue,
      newValue
    );
  }

  private checkAndUpdateNullifier(
    witness: MerkleMapWitness,
    key: Field,
    curValue: Field,
    newValue: Field
  ): MerkleCheckResult {
    return this.checkAndUpdateMap(
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
    key: Field | null,
    curValue: Field,
    newValue: Field
  ): MerkleCheckResult {
    let checkRes = this.checkMap(state, witness, key, curValue);

    const [newRoot] = witness.computeRootAndKey(newValue);
    state.set(newRoot);

    return checkRes;
  }

  private checkMap(
    state: State<Field>,
    witness: MerkleMap20Witness | MerkleMapWitness,
    key: Field | null,
    curValue: Field
  ): MerkleCheckResult {
    const curRoot = state.getAndRequireEquals();

    const [prevRoot, witnessKey] = witness.computeRootAndKey(curValue);
    curRoot.assertEquals(prevRoot, 'Wrong witness');
    if (key) {
      witnessKey.assertEquals(key, 'Wrong key');
    }

    return {
      key: witnessKey,
    };
  }

  private checkAndUpdateTicketMap(
    firstWitness: MerkleMap20Witness | MerkleMapWitness,
    key1: Field | null,
    secondWitness: MerkleMap20Witness | MerkleMapWitness,
    // key2: Field, For know second level key is not checked as later it would transform to merkle map
    prevValue: Field,
    newValue: Field
  ): { ticketId: Field; round: Field } {
    const res = this.checkTicket(firstWitness, key1, secondWitness, prevValue);

    const [newRoot2] = secondWitness.computeRootAndKey(newValue);
    const [newRoot1] = firstWitness.computeRootAndKey(newRoot2);
    this.ticketRoot.set(newRoot1);

    return res;
  }

  private checkTicket(
    firstWitness: MerkleMap20Witness | MerkleMapWitness,
    key1: Field | null,
    secondWitness: MerkleMap20Witness | MerkleMapWitness,
    // key2: Field, For know second level key is not checked as later it would transform to merkle map
    value: Field
  ): { ticketId: Field; round: Field; roundRoot: Field } {
    const [secondLevelRoot, ticketId] = secondWitness.computeRootAndKey(value);

    const [firstLevelRoot, round] =
      firstWitness.computeRootAndKey(secondLevelRoot);

    if (key1) {
      round.assertEquals(key1, 'Wrong round');
    }
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(firstLevelRoot, 'Wrong 2d witness');

    return { ticketId, round, roundRoot: secondLevelRoot };
  }
}
