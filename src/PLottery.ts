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
  convertToUInt32,
  convertToUInt64,
  getEmpty2dMerkleMap,
  getNullifierId,
} from './util.js';
import { MerkleMap20, MerkleMap20Witness } from './CustomMerkleMap.js';
import {
  ActionList,
  LotteryAction,
  TicketReduceProof,
} from './TicketReduceProof.js';

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
    .map((val) => convertToUInt32(val));

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

export class ReduceEvent extends Struct({
  startActionState: Field,
  endActionState: Field,
}) {}

// Parallel lottery
export class PLottery extends SmartContract {
  reducer = Reducer({ actionType: LotteryAction });

  events = {
    'buy-ticket': BuyTicketEvent,
    'produce-result': ProduceResultEvent,
    'get-reward': GetRewardEvent,
    'get-refund': RefundEvent,
    reduce: ReduceEvent,
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

  @state(Field) lastReduceInRound = State<Field>();

  @state(Field) lastProcessedTicketId = State<Field>();

  init() {
    this.network.stakingEpochData.ledger.hash.getAndRequireEquals();
    super.init();

    this.ticketRoot.set(empty2dMapRoot); // Redoo, becase leafs is not 0, but empty map root
    this.ticketNullifier.set(emptyMapRoot);
    this.bankRoot.set(emptyMap20Root);
    this.roundResultRoot.set(emptyMap20Root);

    this.startBlock.set(
      this.network.globalSlotSinceGenesis.getAndRequireEquals()
    );

    this.lastProcessedState.set(Reducer.initialActionState);
    this.lastProcessedTicketId.set(Field(-1));

    // #TODO Permisions
  }

  @method async buyTicket(ticket: Ticket, round: Field) {
    ticket.owner.equals(this.sender.getAndRequireSignature()); // Do we need this check?
    // Ticket validity check
    ticket.check().assertTrue();
    this.checkCurrentRound(convertToUInt32(round));

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
    let lastProcessedTicketId =
      this.lastProcessedTicketId.getAndRequireEquals();

    reduceProof.publicOutput.processedActionList.assertEquals(
      ActionList.emptyHash,
      'Proof is not complete. Call cutActions first'
    );

    // Check that state on contract is equal to state on proof
    lastProcessedState.assertEquals(
      reduceProof.publicOutput.initialState,
      'Initial state is not match contract last processed state'
    );

    // Check that actionState is equal to actionState on proof
    this.account.actionState.requireEquals(reduceProof.publicOutput.finalState);

    // Check inital ticket id
    lastProcessedTicketId.assertEquals(
      reduceProof.publicOutput.initialTicketId,
      'Initial ticket id don not match contract last processed ticket id'
    );

    this.lastProcessedState.set(reduceProof.publicOutput.finalState);
    this.ticketRoot.set(reduceProof.publicOutput.newTicketRoot);
    this.bankRoot.set(reduceProof.publicOutput.newBankRoot);
    this.lastReduceInRound.set(reduceProof.publicOutput.lastProcessedRound);
    this.lastProcessedTicketId.set(
      reduceProof.publicOutput.lastProcessedTicketId
    );

    this.emitEvent(
      'reduce',
      new ReduceEvent({
        startActionState: reduceProof.publicOutput.initialState,
        endActionState: reduceProof.publicOutput.finalState,
      })
    );
  }

  @method async produceResult(
    resultWiness: MerkleMap20Witness,
    result: Field,
    bankValue: Field,
    bankWitness: MerkleMap20Witness
  ) {
    // Check that result for this round is not computed yet, and that witness it is valid
    const [initialResultRoot, round] = resultWiness.computeRootAndKey(
      Field.from(0)
    );

    this.roundResultRoot
      .getAndRequireEquals()
      .assertEquals(initialResultRoot, 'Wrong resultWitness or value');

    this.lastReduceInRound
      .getAndRequireEquals()
      .assertGreaterThan(round, 'Call reduce for this round first');

    // Generate new ticket using value from blockchain
    let winningNumbers = this.getWiningNumbersForRound();

    // let newLeafValue = NumberPacked.pack(winningNumbers);
    let newLeafValue = result; // For test purpose

    // Update result tree
    const [newResultRoot] = resultWiness.computeRootAndKey(newLeafValue);

    this.roundResultRoot.set(newResultRoot);

    // Update bank and pay fee
    this.checkAndUpdateBank(
      bankWitness,
      round,
      bankValue,
      bankValue.mul(PRESICION - COMMISION).div(PRESICION)
    );

    this.send({
      to: treasury,
      amount: convertToUInt64(bankValue.mul(COMMISION).div(PRESICION)),
    });

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
    this.checkRoundPass(convertToUInt32(round.add(2)));

    // Check and update bank witness
    const totalTicketPrice = ticket.amount.mul(TICKET_PRICE);
    const priceWithoutCommision = totalTicketPrice
      .mul(PRESICION - COMMISION)
      .div(PRESICION);
    // const newBankValue = bankValue.sub(totalTicketPrice.value);
    // this.checkAndUpdateBank(bankWitness, round, bankValue, newBankValue);

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
      amount: priceWithoutCommision,
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

    dp.publicInput.winningCombination.assertEquals(
      winningNumbers,
      'Wrong winning numbers in dp'
    );

    round.assertLessThan(
      this.lastReduceInRound.getAndRequireEquals(),
      'Actions was not reduced for this round yet. Call reduceTickets first'
    );

    // Check result root info
    this.checkResult(resutWitness, round, winningNumbers);

    // Compute score using winnging ticket
    const score = ticket.getScore(NumberPacked.unpack(winningNumbers));
    const totalScore = dp.publicOutput.total;

    // Pay user
    this.checkBank(bankWitness, round, bankValue);

    this.send({
      to: ticket.owner,
      amount: convertToUInt64(bankValue).mul(score).div(totalScore),
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

  // @method async getCommisionForRound(
  //   ticketWitness: MerkleMap20Witness,
  //   result: Field,
  //   resultWitness: MerkleMap20Witness,
  //   dp: DistributionProof,
  //   bankValue: Field,
  //   bankWitness: MerkleMap20Witness,
  //   nullifierWitness: MerkleMapWitness
  // ): Promise<void> {
  //   dp.verify();

  //   // Only treasury account can claim commision
  //   this.sender.getAndRequireSignature().assertEquals(treasury);

  //   dp.publicInput.winningCombination.assertEquals(
  //     result,
  //     'Wrong winning numbers in dp'
  //   );

  //   // Check result for round is right
  //   const { key: round } = this.checkResult(resultWitness, null, result);

  //   round.assertLessThan(
  //     this.lastReduceInRound.getAndRequireEquals(),
  //     'Actions was not reduced for this round yet. Call reduceTickets first'
  //   );

  //   // Check bank value for round
  //   this.checkBank(bankWitness, round, bankValue);

  //   // Update nullifier for ticket
  //   this.checkAndUpdateNullifier(
  //     nullifierWitness,
  //     getNullifierId(round, Field(0)),
  //     Field(0),
  //     Field.from(1)
  //   );

  //   // Check ticket
  //   const [ticketRoot, ticketKey] = ticketWitness.computeRootAndKey(
  //     dp.publicOutput.root
  //   );
  //   this.ticketRoot
  //     .getAndRequireEquals()
  //     .assertEquals(ticketRoot, 'Wrong ticket root');
  //   ticketKey.assertEquals(round, 'Wrong ticket round');

  //   // Send commision to treasury
  //   const totalScore = getTotalScoreAndCommision(dp.publicOutput.total);

  //   this.send({
  //     to: treasury,
  //     amount: totalScore.sub(dp.publicOutput.total),
  //   });
  // }

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
      startBlock.add(round.add(1).mul(BLOCK_PER_ROUND)),
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

  // private checkAndUpdateResult(
  //   witness: MerkleMap20Witness,
  //   round: Field,
  //   curValue: Field,
  //   newValue: Field
  // ): MerkleCheckResult {
  //   return this.checkAndUpdateMap(
  //     this.roundResultRoot,
  //     witness,
  //     round,
  //     curValue,
  //     newValue
  //   );
  // }

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

  // private checkAndUpdateTicketMap(
  //   firstWitness: MerkleMap20Witness | MerkleMapWitness,
  //   key1: Field | null,
  //   secondWitness: MerkleMap20Witness | MerkleMapWitness,
  //   // key2: Field, For know second level key is not checked as later it would transform to merkle map
  //   prevValue: Field,
  //   newValue: Field
  // ): { ticketId: Field; round: Field } {
  //   const res = this.checkTicket(firstWitness, key1, secondWitness, prevValue);

  //   const [newRoot2] = secondWitness.computeRootAndKey(newValue);
  //   const [newRoot1] = firstWitness.computeRootAndKey(newRoot2);
  //   this.ticketRoot.set(newRoot1);

  //   return res;
  // }

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
