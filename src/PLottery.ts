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
import { RandomManager } from './Random/RandomManager.js';

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

  // Questionable
  @state(Bool) reduced = State<Bool>();

  // // Round in witch last reduce happened
  // @state(Field) lastReduceInRound = State<Field>();

  // // Last processed ticketId by reducer
  // @state(Field) lastProcessedTicketId = State<Field>();

  init() {
    super.init();

    /// !!!! This contracts is deployed from factory. No init call there

    this.ticketRoot.set(emptyMap20Root);
    this.ticketNullifier.set(emptyMapRoot);
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
   * @param round The lottery round for which the ticket is being purchased.
   *
   * @require The sender must be the owner of the ticket.
   * @require The ticket must be valid as per the ticket validity check.
   * @require The specified round must be the current lottery round.
   *
   * @event buy-ticket Emitted when a ticket is successfully purchased.
   */
  @method async buyTicket(ticket: Ticket, round: Field) {
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
      this.sender.getAndRequireSignature()
    );

    senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(ticket.amount) });

    // Dispatch action and emit event
    this.reducer.dispatch(
      new LotteryAction({
        ticket,
        round, // #TODO remove
      })
    );
    this.emitEvent(
      'buy-ticket',
      new BuyTicketEvent({
        ticket,
        round: round, // #TODO remove
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
  @method async reduceTickets(reduceProof: TicketReduceProof) {
    // Check proof validity
    reduceProof.verify();

    // Only after round is passed
    this.checkRoundPass(UInt32.from(1));

    let initialRoot = this.ticketRoot.getAndRequireEquals();
    let initialBank = this.bank.getAndRequireEquals();

    // Check initial root equal
    reduceProof.publicOutput.initialTicketRoot.assertEquals(
      initialRoot,
      'Wrong initial root'
    );

    reduceProof.publicOutput.initialBank.assertEquals(
      initialBank,
      'Wrong bank'
    );

    // Check that all actions was processed.
    reduceProof.publicOutput.processedActionList.assertEquals(
      ActionList.emptyHash,
      'Proof is not complete. Call cutActions first'
    );

    // Check that actionState is equal to actionState on proof
    this.account.actionState
      .getAndRequireEquals()
      .assertEquals(reduceProof.publicOutput.finalState);

    // Update onchain values
    this.ticketRoot.set(reduceProof.publicOutput.newTicketRoot);
    this.bank.set(reduceProof.publicOutput.newBank);
    this.reduced.set(Bool(true));

    // Emit event
    this.emitEvent('reduce', new ReduceEvent({}));
  }

  /**
   * @notice Generate winning combination for round
   * @dev Random number seed is taken from RandomManager contract for this round.
   *        Then using this seed 6 number is generated and stored
   *
   * @param resultWitness The Merkle proof witness for the current result tree.
   * @param bankValue The current value in the bank for this round.
   * @param bankWitness The Merkle proof witness for the bank tree.
   * @param rmWitness The Merkle proof witness for the random value tree(tree is stored on RandomManager contract).
   * @param rmValue The random value used to generate winning numbers.
   *
   * @require The result for this round must not have been computed yet.
   * @require The provided result witness must be valid and match the initial result root.
   * @require The round must have been reduced before the result can be computed.
   * @require The random value should match one, that is stored on RandomManager contract.
   *
   * @event produce-result Emitted when the result is successfully produced and the result tree is updated.
   */
  @method async produceResult() {
    // Check that result for this round is not computed yet
    const result = this.result.getAndRequireEquals();
    result.assertEquals(Field(0), 'Result for this round is already computed');

    const reduced = this.reduced.getAndRequireEquals();
    reduced.assertTrue('Actions was not reduced for this round yet');

    const RM = new RandomManager(this.randomManager.getAndRequireEquals());
    const rmValue = RM.result.getAndRequireEquals();

    // Generate new winning combination using random number from NumberManager
    let winningNumbers = generateNumbersSeed(rmValue);
    let resultPacked = NumberPacked.pack(winningNumbers);

    this.result.set(resultPacked);

    const bankValue = this.bank.getAndRequireEquals();
    this.bank.set(bankValue.mul(PRECISION - COMMISSION).div(PRECISION));

    this.send({
      to: treasury,
      amount: convertToUInt64(bankValue.mul(COMMISSION).div(PRECISION)),
    });

    this.emitEvent(
      'produce-result',
      new ProduceResultEvent({
        result: resultPacked,
        round: Field(0), // #TODO remove
      })
    );
  }

  // Update refund natspec
  /**
   * @notice Processes a refund for a lottery ticket if the result for the round was not generated within 2 days.
   * @dev This function ensures that the ticket owner is the one requesting the refund, verifies the ticket's validity
   *      in the Merkle maps, checks that the result for the round is zero, and processes the refund after verifying
   *      and updating the necessary states.
   *
   * @param ticket The lottery ticket for which the refund is being requested.
   * @param roundWitness The 1st level Merkle proof witness for the tickets tree.
   * @param roundTicketWitness The 2nd level Merkle proof witness for the round's ticket tree.
   * @param resultWitness The Merkle proof witness for the result tree.
   * @param bankValue The value of bank for that round.
   * @param bankWitness The Merkle proof witness for bank tree.
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
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());

    const result = this.result.getAndRequireEquals();
    result.assertEquals(Field(0), 'Result for this round is not zero');

    // Check ticket in merkle map and set ticket to zero
    const [ticketRoot, _] = ticketWitness.computeRootAndKeyV2(ticket.hash());
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
        ticket,
        round: Field(0), // #TODO remove
      })
    );
  }

  /**
   * @notice Claims the reward for a winning lottery ticket.
   * @dev This function calculate ticket score, totalScore is obtained from DistributionProof,
   *        and then sends appropriate potion of bank to ticket owner. Finally it nullify the ticket.
   *
   * @param ticket The lottery ticket for which the reward is being claimed.
   * @param roundWitness The 1s level Merkle proof witness for the ticket tree.
   * @param roundTicketWitness The 2nd level Merkle proof witness for the ticket tree.
   * @param dp The distribution proof to verify the winning numbers and ticket distribution.
   * @param winningNumbers The winning numbers for the current round.
   * @param resultWitness The Merkle proof witness for the result tree.
   * @param bankValue The current value in the bank for this round.
   * @param bankWitness The Merkle proof witness for the bank tree.
   * @param nullifierWitness The Merkle proof witness for the nullifier tree.
   *
   * @require The sender must be the owner of the ticket.
   * @require The distribution proof must be valid and match the round's ticket root and winning numbers.
   * @require The ticket must exist in the Merkle map as verified by the round and ticket witnesses.
   * @require The actions for the round must be reduced before claiming the reward.
   * @require The result root must match the winning numbers for the round.
   * @require The bank value must be verified and sufficient to cover the reward.
   *
   * @event get-reward Emitted when the reward is successfully claimed and transferred to the ticket owner.
   */
  @method async getReward(
    ticket: Ticket,
    ticketWitness: MerkleMap20Witness,
    dp: DistributionProof,
    nullifierWitness: MerkleMapWitness
  ) {
    // Check that owner trying to claim
    ticket.owner.assertEquals(this.sender.getAndRequireSignature());
    // Verify distribution proof
    dp.verify();

    // Check ticket in tree
    const [ticketRoot, ticketId] = ticketWitness.computeRootAndKeyV2(
      ticket.hash()
    );
    this.ticketRoot
      .getAndRequireEquals()
      .assertEquals(ticketRoot, 'Wrong ticket witness');

    dp.publicOutput.root.assertEquals(ticketRoot, 'Wrong distribution proof');

    const winningNumbers = this.result.getAndRequireEquals();

    dp.publicInput.winningCombination.assertEquals(
      winningNumbers,
      'Wrong winning numbers in dp'
    );

    this.reduced
      .getAndRequireEquals()
      .assertTrue('Actions was not reduced yet');

    // Compute score using winning ticket
    const score = ticket.getScore(NumberPacked.unpack(winningNumbers));
    const totalScore = dp.publicOutput.total;

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
        round: Field(0), // #TODO remove
      })
    );
  }

  /**
   * @notice Check that execution is happening within provided round
   *
   * @param round Round to be checked
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
   * @param round Round to be checked
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
   * @param round Round number, that will be compared with <witness> key.
   * @param curValue Value of nullifier to be checked.
   * @param newValue New value that should be store in tree.
   *
   * @returns key of <witness>
   */
  public checkAndUpdateNullifier(
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

//   return PLottery;
// }

// export type PLotteryType = InstanceType<ReturnType<typeof getPLottery>>;
