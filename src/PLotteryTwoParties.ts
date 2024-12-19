import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMapWitness,
  AccountUpdate,
  Gadgets,
  PublicKey,
  MerkleMap,
  Struct,
  Reducer,
  Provable,
  UInt64,
  Permissions,
  TransactionVersion,
  VerificationKey,
  Bool,
} from 'o1js';
import { Ticket } from './Structs/Ticket.js';
import {
  BLOCK_PER_ROUND,
  COMMISSION,
  NUMBERS_IN_TICKET,
  PRECISION,
  TICKET_PRICE,
  ZkOnCoordinatorAddress,
  mockWinningCombination,
  treasury,
} from './constants.js';
import { DistributionProof } from './Proofs/DistributionProof.js';
import { NumberPacked, convertToUInt32, convertToUInt64 } from './util.js';
import { MerkleMap20, MerkleMap20Witness } from './Structs/CustomMerkleMap.js';
import {
  ActionList,
  LotteryAction,
  TicketReduceProof,
} from './Proofs/TicketReduceProof.js';
import { RandomManager } from './Random/RandomManagerTwoParties.js';

export interface MerkleCheckResult {
  key: Field;
}

export const mockResult = NumberPacked.pack(
  mockWinningCombination.map((v) => UInt32.from(v))
);

export const generateNumbersSeed = (seed: Field): UInt32[] => {
  let bits = seed.toBits();
  const numbers = [...Array(6)].map((_, i) => {
    let res64 = UInt64.from(0);
    res64.value = Field.fromBits(bits.slice(42 * i, 42 * (i + 1)));
    res64 = res64.mod(9).add(1);
    let res = UInt32.from(0);
    res.value = res64.value;
    return res;
  });
  return numbers;
};

const max = (a: UInt64, b: UInt64): UInt64 => {
  return Provable.if(a.greaterThan(b), a, b);
};

const emptyMapRoot = new MerkleMap().getRoot();
const emptyMap20Root = new MerkleMap20().getRoot();

export class BuyTicketEvent extends Struct({
  ticket: Ticket,
}) {}

export class ProduceResultEvent extends Struct({
  result: Field,
  totalScore: UInt64,
  bank: Field,
}) {}

export class GetRewardEvent extends Struct({
  ticket: Ticket,
}) {}

export class RefundEvent extends Struct({
  ticketId: Field,
  ticket: Ticket,
}) {}

export class ReduceEvent extends Struct({}) {}

export class PLottery extends SmartContract {
  reducer = Reducer({ actionType: LotteryAction });

  events = {
    'buy-ticket': BuyTicketEvent,
    'produce-result': ProduceResultEvent,
    'get-reward': GetRewardEvent,
    'get-refund': RefundEvent,
    reduce: ReduceEvent,
  };
  // Do not change order of storage, as it would affect deployment via factory
  // !!!!First slot for outer initializer
  @state(PublicKey) randomManager = State<PublicKey>();

  // Stores block of deploy
  @state(UInt32) startSlot = State<UInt32>();

  // Stores merkle map with all tickets, that user have bought
  @state(Field) ticketRoot = State<Field>();

  // Stores nullifier tree root for tickets, so one ticket can't be used twice
  @state(Field) ticketNullifier = State<Field>();

  // Stores merkle map with total bank for each round.
  @state(Field) bank = State<Field>();

  // Stores merkle map with wining combination for each rounds
  @state(Field) result = State<Field>();

  @state(UInt64) totalScore = State<UInt64>();

  init() {
    super.init();

    /// !!!! This contracts is deployed from factory. No init call there

    this.ticketRoot.set(emptyMap20Root);
    this.ticketNullifier.set(emptyMap20Root);
    this.startSlot.set(
      this.network.globalSlotSinceGenesis.getAndRequireEquals()
    );

    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
    });
  }

  /**
   * @notice Set verification key for account
   * @dev verification key can be updated only if Mina hardfork happen. It allows zkApp to be live after Mina hardfork
   * @param vk Verification key
   */
  @method async updateVerificationKey(vk: VerificationKey) {
    this.account.verificationKey.set(vk);
  }

  /**
   * @notice Allows a user to buy a lottery ticket for a specific round.
   * @dev No ticket merkle tree update happens here. Only action is dispatched.
   *
   * @param ticket The lottery ticket being purchased.
   *
   * @require The ticket must be valid as per the ticket validity check.
   * @require The specified round must be the current lottery round.
   *
   * @event buy-ticket Emitted when a ticket is successfully purchased.
   */
  @method async buyTicket(ticket: Ticket) {
    // Ticket validity check
    ticket.check().assertTrue();

    ticket.amount.assertGreaterThan(
      UInt64.from(0),
      'Ticket amount should be positive'
    );

    // Round check
    this.checkCurrentRound();

    // Take ticket price from user
    let senderUpdate = AccountUpdate.createSigned(
      this.sender.getAndRequireSignatureV2()
    );

    senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(ticket.amount) });

    // Dispatch action and emit event
    this.reducer.dispatch(
      new LotteryAction({
        ticket,
      })
    );
    this.emitEvent(
      'buy-ticket',
      new BuyTicketEvent({
        ticket,
      })
    );
  }

  /**
   * @notice Reduce tickets that lies as actions.
   * @dev This function verifies the proof and ensures that the contract's state matches the state described in the proof.
   *      It then updates the tickets merkle tree, populating it with new tickets.
   *
   * @param reduceProof The proof that validates the ticket reduction process and contains the new contract state.
   *
   * @require The proof must be valid and successfully verified.
   * @require The processed action list in the proof must be empty, indicating that all actions have been processed.
   * @require The contract's last processed state must match the initial state in the proof.
   * @require The contract's action state must match the final state in the proof.
   * @require The contract's last processed ticket ID must match the initial ticket ID in the proof.
   *
   * @event reduce Emitted when the tickets are successfully reduced and the contract state is updated.
   */
  @method async reduceTicketsAndProduceResult(reduceProof: TicketReduceProof) {
    this.result
      .getAndRequireEquals()
      .assertEquals(Field(0), 'Already produced');
    // Only after round is passed
    this.checkRoundPass(UInt32.from(1));

    // Get random value
    const RM = new RandomManager(this.randomManager.getAndRequireEquals());
    const rmValue = RM.result.getAndRequireEquals();
    rmValue.assertGreaterThan(Field(0), 'Random value was not generated yet');
    this.approve(RM.self);

    let winningNumbers = generateNumbersSeed(rmValue);
    let winningNumbersPacked = NumberPacked.pack(winningNumbers);

    this.checkReduceProof(reduceProof, winningNumbersPacked);

    const bankValue = reduceProof.publicOutput.newBank;

    this.send({
      to: treasury,
      amount: convertToUInt64(bankValue.mul(COMMISSION).div(PRECISION)),
    });

    const newBankValue = bankValue.mul(PRECISION - COMMISSION).div(PRECISION);

    // Update onchain values
    this.ticketRoot.set(reduceProof.publicOutput.newTicketRoot);
    this.bank.set(newBankValue);
    this.totalScore.set(reduceProof.publicOutput.totalScore);
    this.result.set(winningNumbersPacked);

    // Emit event
    // this.emitEvent('reduce', new ReduceEvent({}));
    this.emitEvent(
      'produce-result',
      new ProduceResultEvent({
        result: winningNumbersPacked,
        bank: newBankValue,
        totalScore: reduceProof.publicOutput.totalScore,
      })
    );
  }

  // If random manager can't produce value
  @method async emergencyReduceTickets(reduceProof: TicketReduceProof) {
    // Allow only after 2 round pass
    this.checkRoundPass(UInt32.from(2));
    // And no result produce
    this.result.getAndRequireEquals().assertEquals(Field(0));

    this.checkReduceProof(reduceProof, Field(0));
    this.ticketRoot.set(reduceProof.publicOutput.newTicketRoot);
  }

  checkReduceProof(
    reduceProof: TicketReduceProof,
    winningNumbersPacked: Field
  ) {
    // Check proof validity
    reduceProof.verify();

    // Check that all actions was processed.
    reduceProof.publicOutput.processedActionList.assertEquals(
      ActionList.emptyHash,
      'Proof is not complete. Call cutActions first'
    );

    // Check random value
    reduceProof.publicOutput.winningNumbersPacked.assertEquals(
      winningNumbersPacked,
      'Wrong winning combination used in proof'
    );

    // If emergency reduce was previously call then check that ticketRoot is equal to newTicketRoot
    const currentRoot = this.ticketRoot.getAndRequireEquals();
    currentRoot
      .equals(new MerkleMap20().getRoot())
      .or(currentRoot.equals(reduceProof.publicOutput.newTicketRoot))
      .assertTrue('Wrong ticket root');

    // Check that actionState is equal to actionState on proof
    this.account.actionState
      .getAndRequireEquals()
      .assertEquals(reduceProof.publicOutput.finalState);
  }

  /*
  1) Common check 
  2) Check reduce
  3) Write values
  */

  /**
   * @notice Generate winning combination for round
   * @dev Random number seed is taken from RandomManager contract for this round.
   *        Then using this seed 6 number is generated and stored
   *
   * @require The result must not have been computed yet.
   * @require The round must have been reduced before the result can be computed.
   *
   * @event produce-result Emitted when the result is successfully produced and the result tree is updated.
   */
  // @method async produceResult() {
  //   // Check that result for this round is not computed yet
  //   const result = this.result.getAndRequireEquals();
  //   result.assertEquals(Field(0), 'Result for this round is already computed');

  //   const reduced = this.reduced.getAndRequireEquals();
  //   reduced.assertTrue('Actions was not reduced for this round yet');

  //   const RM = new RandomManager(this.randomManager.getAndRequireEquals());
  //   const rmValue = RM.result.getAndRequireEquals();

  //   // Generate new winning combination using random number from NumberManager
  //   let winningNumbers = generateNumbersSeed(rmValue);
  //   let resultPacked = NumberPacked.pack(winningNumbers);

  //   this.result.set(resultPacked);

  //   const bankValue = this.bank.getAndRequireEquals();
  //   this.bank.set(bankValue.mul(PRECISION - COMMISSION).div(PRECISION));

  //   this.send({
  //     to: treasury,
  //     amount: convertToUInt64(bankValue.mul(COMMISSION).div(PRECISION)),
  //   });

  //   this.emitEvent(
  //     'produce-result',
  //     new ProduceResultEvent({
  //       result: resultPacked,
  //     })
  //   );
  // }

  // Update refund natspec
  /**
   * @notice Processes a refund for a lottery ticket if the result for the round was not generated within 2 days.
   * @dev This function ensures that the ticket owner is the one requesting the refund, verifies the ticket's validity
   *      in the Merkle maps, checks that the result for the round is zero, and processes the refund after verifying
   *      and updating the necessary states.
   *
   * @param ticket The lottery ticket for which the refund is being requested.
   * @param ticketWitness Witness of the ticket in the ticketMap tree.
   *
   * @require The sender must be the owner of the ticket.
   * @require The ticket must exist in the Merkle map as verified by the round and ticket witnesses.
   * @require The result for the round must be zero to be eligible for a refund.
   * @require The refund can only be processed after approximately two days since the round finished.
   *
   * @event get-refund Emitted when a refund is successfully processed and the ticket price is returned to the user.
   */
  @method async refund(ticket: Ticket, ticketWitness: MerkleMap20Witness) {
    // Check that owner trying to claim
    ticket.owner.assertEquals(this.sender.getAndRequireSignatureV2());

    const result = this.result.getAndRequireEquals();
    result.assertEquals(Field(0), 'Result for this round is not zero');

    // Check ticket in merkle map and set ticket to zero
    const [ticketRoot, ticketId] = ticketWitness.computeRootAndKeyV2(
      ticket.hash()
    );
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRoot, 'Wrong ticket witness');
    const [newTicketRoot] = ticketWitness.computeRootAndKeyV2(Field(0));
    this.ticketRoot.set(newTicketRoot);

    // Can call refund after ~ 2 days after round finished
    this.checkRoundPass(UInt32.from(2));

    // Check and update bank witness
    const totalTicketPrice = ticket.amount.mul(TICKET_PRICE);
    const bankValue = this.bank.getAndRequireEquals();
    const newBankValue = bankValue.sub(totalTicketPrice.value);
    this.bank.set(newBankValue);

    // Send ticket price back to user
    this.send({
      to: ticket.owner,
      amount: totalTicketPrice,
    });

    this.emitEvent(
      'get-refund',
      new RefundEvent({
        ticketId,
        ticket,
      })
    );
  }

  /**
   * @notice Claims the reward for a winning lottery ticket.
   * @dev This function calculate ticket score, totalScore is obtained from DistributionProof,
   *        and then sends appropriate potion of bank to ticket owner. Finally it nullify the ticket.
   *
   * @param ticket The lottery ticket for which the reward is being claimed.
   * @param ticketWitness Witness of the ticket in the ticketMap tree.
   * @param nullifierWitness The Merkle proof witness for the nullifier tree.
   *
   * @require The sender must be the owner of the ticket.
   * @require The distribution proof must be valid and match the round's ticket root and winning numbers.
   * @require The ticket must exist in the Merkle map as verified by the round and ticket witnesses.
   * @require The actions for the round must be reduced before claiming the reward.
   *
   * @event get-reward Emitted when the reward is successfully claimed and transferred to the ticket owner.
   */
  @method async getReward(
    ticket: Ticket,
    ticketWitness: MerkleMap20Witness,
    nullifierWitness: MerkleMap20Witness
  ) {
    // Check ticket in tree
    const [ticketRoot, ticketId] = ticketWitness.computeRootAndKeyV2(
      ticket.hash()
    );
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRoot, 'Wrong ticket witness');

    const winningNumbers = this.result.getAndRequireEquals();
    winningNumbers.assertGreaterThan(
      Field(0),
      'Winning number is not generated yet'
    );

    // Compute score using winning ticket
    const score = ticket.getScore(NumberPacked.unpack(winningNumbers));
    const totalScore = this.totalScore.getAndRequireEquals();

    const bank = this.bank.getAndRequireEquals();

    const payAmount = convertToUInt64(bank).mul(score).div(totalScore);

    this.send({
      to: ticket.owner,
      amount: payAmount,
    });

    // Add ticket to nullifier
    this.checkAndUpdateNullifier(
      nullifierWitness,
      ticketId,
      Field(0),
      Field.from(1)
    );

    this.emitEvent(
      'get-reward',
      new GetRewardEvent({
        ticket,
      })
    );
  }

  /**
   * @notice Check that execution is happening within provided round
   *
   *
   * @require globalSlotSinceGenesis to be within range of round
   */
  public checkCurrentRound() {
    const startSlot = this.startSlot.getAndRequireEquals();
    this.network.globalSlotSinceGenesis.requireBetween(
      startSlot,
      startSlot.add(BLOCK_PER_ROUND).sub(1)
    );
  }

  /**
   * @notice Check that execution is happening after provided round
   *
   * @param amount Amounts of rounds to pass to check
   *
   * @require globalSlotSinceGenesis to be greater then last slot of given number
   */
  public checkRoundPass(amount: UInt32) {
    const startSlot = this.startSlot.getAndRequireEquals();
    this.network.globalSlotSinceGenesis.requireBetween(
      startSlot.add(amount.mul(BLOCK_PER_ROUND)),
      UInt32.MAXINT()
    );
  }

  /**
   * @notice Check validity of merkle map witness for nullifier tree and then updates tree with new value.
   *
   * @param witness Merkle map witness for nullifier tree.
   * @param key Round number, that will be compared with <witness> key.
   * @param curValue Value of nullifier to be checked.
   * @param newValue New value that should be store in tree.
   *
   * @returns key of <witness>
   */
  public checkAndUpdateNullifier(
    witness: MerkleMap20Witness,
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

  /**
   * @notice General method that allows to check and update onchain merkle trees roots
   *
   * @param state On-chain state, that should be updated.
   * @param witness Merkle map witness.
   * @param key Key that will be compared with <witness> key.
   * @param curValue Value to be checked.
   * @param newValue New value that should be store in tree.
   *
   * @returns key of <witness>
   */
  public checkAndUpdateMap(
    state: State<Field>,
    witness: MerkleMap20Witness | MerkleMapWitness,
    key: Field,
    curValue: Field,
    newValue: Field
  ): MerkleCheckResult {
    let checkRes = this.checkMap(state, witness, key, curValue);

    const [newRoot] = witness.computeRootAndKeyV2(newValue);
    state.set(newRoot);

    return checkRes;
  }

  /**
   * @notice General method that allows to check onchain merkle trees roots
   *
   * @param state On-chain state, that should be updated.
   * @param witness Merkle map witness.
   * @param key Key that will be compared with <witness> key.
   * @param curValue Value to be checked.
   *
   * @returns key of <witness>
   */
  public checkMap(
    state: State<Field>,
    witness: MerkleMap20Witness | MerkleMapWitness,
    key: Field,
    curValue: Field
  ): MerkleCheckResult {
    const curRoot = state.getAndRequireEquals();

    const [prevRoot, witnessKey] = witness.computeRootAndKeyV2(curValue);
    curRoot.assertEquals(prevRoot, 'Wrong witness');
    witnessKey.assertEquals(key, 'Wrong key');

    return {
      key: witnessKey,
    };
  }
}
