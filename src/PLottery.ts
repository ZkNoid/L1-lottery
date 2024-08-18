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
} from 'o1js';
import { Ticket } from './Ticket.js';
import {
  BLOCK_PER_ROUND,
  COMMISION,
  NUMBERS_IN_TICKET,
  PRESICION,
  TICKET_PRICE,
  mockWinningCombination,
  treasury,
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
import { getRandomManager } from './Random/RandomManager.js';

export interface MerkleCheckResult {
  key: Field;
}

export const mockResult = NumberPacked.pack(
  mockWinningCombination.map((v) => UInt32.from(v))
);

export const generateNumbersSeed = (seed: Field): UInt32[] => {
  const initMask = 0b1111;
  const masks = [...Array(NUMBERS_IN_TICKET)].map(
    (val, i) => initMask << (i * 4)
  );

  const numbers = masks
    .map((mask, i) => {
      const masked = Gadgets.and(seed, Field.from(mask), 254);
      return Gadgets.rightShift64(masked, i * 4);
    })
    .map((val) => convertToUInt32(val))
    .map((val) => val.mod(9).add(1));

  return numbers;
};

const emptyMapRoot = new MerkleMap().getRoot();
const emptyMap20Root = new MerkleMap20().getRoot();

const empty2dMap = getEmpty2dMerkleMap(20);
const empty2dMapRoot = empty2dMap.getRoot();

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

export function getPLottery(
  randomManagerAddress: PublicKey,
  randomManagerOwner: PublicKey
) {
  class RandomManager extends getRandomManager(randomManagerOwner) {}

  class PLottery extends SmartContract {
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

    // Stores nullifier tree root for tickets, so one ticket can't be used twice
    @state(Field) ticketNullifier = State<Field>();

    // Stores merkle map with total bank for each round.
    @state(Field) bankRoot = State<Field>();

    // Stores merkle map with wining combination for each rounds
    @state(Field) roundResultRoot = State<Field>();

    // Stores block of deploy
    @state(UInt32) startBlock = State<UInt32>();

    // Stores last action state, that was processed by reducer
    @state(Field) lastProcessedState = State<Field>();

    // Round in witch last reduce happened
    @state(Field) lastReduceInRound = State<Field>();

    // Last processed ticketId by reducer
    @state(Field) lastProcessedTicketId = State<Field>();

    init() {
      super.init();

      this.ticketRoot.set(empty2dMapRoot);
      this.ticketNullifier.set(emptyMapRoot);
      this.bankRoot.set(emptyMap20Root);
      this.roundResultRoot.set(emptyMap20Root);
      this.startBlock.set(
        this.network.globalSlotSinceGenesis.getAndRequireEquals()
      );
      this.lastProcessedState.set(Reducer.initialActionState);
      this.lastProcessedTicketId.set(Field(-1));
    }

    /**
     * @notice Allows a user to buy a lottery ticket for a specific round.
     * @dev No ticket merkle tree update happens here. Only action is dispathched.
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
      ticket.owner.equals(this.sender.getAndRequireSignature());
      ticket.check().assertTrue();

      // Round check
      this.checkCurrentRound(convertToUInt32(round));

      // Take ticket price from user
      let senderUpdate = AccountUpdate.createSigned(
        this.sender.getAndRequireSignature()
      );

      senderUpdate.send({ to: this, amount: TICKET_PRICE.mul(ticket.amount) });

      // Dispatch action and emmit event
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

      let lastProcessedState = this.lastProcessedState.getAndRequireEquals();
      let lastProcessedTicketId =
        this.lastProcessedTicketId.getAndRequireEquals();
      let initialRoot = this.ticketRoot.getAndRequireEquals();

      // Check match of proof data and onchain values.

      // Check initial root equal
      reduceProof.publicOutput.initialTicketRoot.assertEquals(
        initialRoot,
        'Wrong initial root'
      );

      // Check that all actions was processed.
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
      this.account.actionState.requireEquals(
        reduceProof.publicOutput.finalState
      );

      // Check inital ticket id
      lastProcessedTicketId.assertEquals(
        reduceProof.publicOutput.initialTicketId,
        'Initial ticket id don not match contract last processed ticket id'
      );

      // Update onchain values
      this.lastProcessedState.set(reduceProof.publicOutput.finalState);
      this.ticketRoot.set(reduceProof.publicOutput.newTicketRoot);
      this.bankRoot.set(reduceProof.publicOutput.newBankRoot);
      this.lastReduceInRound.set(reduceProof.publicOutput.lastProcessedRound);
      this.lastProcessedTicketId.set(
        reduceProof.publicOutput.lastProcessedTicketId
      );

      // Emit event
      this.emitEvent(
        'reduce',
        new ReduceEvent({
          startActionState: reduceProof.publicOutput.initialState,
          endActionState: reduceProof.publicOutput.finalState,
        })
      );
    }

    /**
     * @notice Generate winning combination for round
     * @dev Random number seed is taken from RandomManager contract for this round.
     *        Then using this seed 6 number is generated and stored
     *
     * @param resultWiness The Merkle proof witness for the current result tree.
     * @param bankValue The current value in the bank for this round.
     * @param bankWitness The Merkle proof witness for the bank tree.
     * @param rmWitness The Merkle proof witness for the random value tree(tree is stored on RandomManager contract).
     * @param rmValue The random value used to generate winning numbers.
     *
     * @require The result for this round must not have been computed yet.
     * @require The provided result witness must be valid and match the initial result root.
     * @require The round must have been reduced before the result can be computed.
     * @require The random value shoud match one, that is stored on RandomManager contract.
     *
     * @event produce-result Emitted when the result is successfully produced and the result tree is updated.
     */
    @method async produceResult(
      resultWiness: MerkleMap20Witness,
      bankValue: Field,
      bankWitness: MerkleMap20Witness,
      rmWitness: MerkleMapWitness,
      rmValue: Field
    ) {
      // Check that result for this round is not computed yet, and that witness is valid
      const [initialResultRoot, round] = resultWiness.computeRootAndKey(
        Field.from(0)
      );

      this.roundResultRoot
        .getAndRequireEquals()
        .assertEquals(initialResultRoot, 'Wrong resultWitness or value');

      this.lastReduceInRound
        .getAndRequireEquals()
        .assertGreaterThan(round, 'Call reduce for this round first');

      this.checkRandomResultValue(rmWitness, rmValue, round);

      // Generate new winning combination using random number from NumberManager
      let winningNumbers = generateNumbersSeed(rmValue);
      let newLeafValue = NumberPacked.pack(winningNumbers);

      // Update result tree
      const [newResultRoot] = resultWiness.computeRootAndKey(newLeafValue);

      this.roundResultRoot.set(newResultRoot);

      // Send fee to treasury
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
    @method async refund(
      ticket: Ticket,
      roundWitness: MerkleMap20Witness,
      roundTicketWitness: MerkleMap20Witness,
      resultWitness: MerkleMap20Witness,
      bankValue: Field,
      bankWitness: MerkleMap20Witness
      // nullifierWitness: MerkleMapWitness
    ) {
      // Check taht owner trying to claim
      ticket.owner.assertEquals(this.sender.getAndRequireSignature());

      // Check ticket in merkle map and set ticket to zero
      const { ticketId, round } = this.checkAndUpdateTicket(
        roundWitness,
        // null,
        roundTicketWitness,
        ticket.hash(),
        Field(0)
      );

      // Check that result is zero for this round
      this.checkResult(resultWitness, round, Field(0));

      // Can call refund after ~ 2 days after round finished
      this.checkRoundPass(convertToUInt32(round.add(2)));

      // Check and update bank witness
      const totalTicketPrice = ticket.amount.mul(TICKET_PRICE);
      // const priceWithoutCommision = totalTicketPrice
      //   .mul(PRESICION - COMMISION)
      //   .div(PRESICION);
      const newBankValue = bankValue.sub(totalTicketPrice.value);
      this.checkAndUpdateBank(bankWitness, round, bankValue, newBankValue);

      // Check and update nullifier
      // this.checkAndUpdateNullifier(
      //   nullifierWitness,
      //   getNullifierId(round, ticketId),
      //   Field(0),
      //   Field.from(1)
      // );

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

    /**
     * @notice Claims the reward for a winning lottery ticket.
     * @dev Thif function calculate ticket score, totalScore is obtained from DistibutionProof,
     *        and then sends apropriate potion of bank to ticket owner. Finally it nullify the ticket.
     *
     * @param ticket The lottery ticket for which the reward is being claimed.
     * @param roundWitness The 1s level Merkle proof witness for the ticket tree.
     * @param roundTicketWitness The 2nd level Merkle proof witness for the ticket tree.
     * @param dp The distribution proof to verify the winning numbers and ticket distribution.
     * @param winningNumbers The winning numbers for the current round.
     * @param resutWitness The Merkle proof witness for the result tree.
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
      } = this.checkTicket(
        roundWitness,
        // null,
        roundTicketWitness,
        ticket.hash()
      );

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

      const payAmount = convertToUInt64(bankValue).mul(score).div(totalScore);
      // Pay user
      this.checkBank(bankWitness, round, bankValue);

      this.send({
        to: ticket.owner,
        amount: payAmount,
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

    /**
     * @notice Checks the validity of the random result value for a specific round.
     * @dev This function verifies that the random result value is greater than zero, confirms that the result root
     *      from the Random Manager matches the provided witness, and ensures the round matches the expected round.
     *
     * @param roundResultWitness The Merkle proof witness for the round result value.
     * @param roundResulValue The random result value to be checked.
     * @param round The round for which the random result value is being checked.
     *
     * @require The random result value must be greater than zero.
     * @require The result root from the Random Manager must match the provided witness.
     * @require The round number must match the expected round in the proof.
     */
    public checkRandomResultValue(
      roundResultWitness: MerkleMapWitness,
      roundResulValue: Field,
      round: Field
    ) {
      roundResulValue.assertGreaterThan(Field(0));
      const rm = new RandomManager(randomManagerAddress);
      const resultRoot = rm.resultRoot.getAndRequireEquals();

      const [prevResultRoot, prevRound] =
        roundResultWitness.computeRootAndKey(roundResulValue);
      prevResultRoot.assertEquals(
        resultRoot,
        'checkResultValue: wrong result witness'
      );

      prevRound.assertEquals(round, 'checkResultValue: wrong round');
    }

    /**
     * @notice Check that execution is happening within provided round
     *
     * @param round Round to be checked
     *
     * @require globalSlotSinceGenesis to be within range of round
     */
    public checkCurrentRound(round: UInt32) {
      const startBlock = this.startBlock.getAndRequireEquals();
      this.network.globalSlotSinceGenesis.requireBetween(
        startBlock.add(round.mul(BLOCK_PER_ROUND)),
        startBlock.add(round.add(1).mul(BLOCK_PER_ROUND))
      );
    }

    /**
     * @notice Check that execution is happening after provided round
     *
     * @param round Round to be checked
     *
     * @require globalSlotSinceGenesis to be greater then last slot of given number
     */
    public checkRoundPass(round: UInt32) {
      const startBlock = this.startBlock.getAndRequireEquals();
      this.network.globalSlotSinceGenesis.requireBetween(
        startBlock.add(round.add(1).mul(BLOCK_PER_ROUND)),
        UInt32.MAXINT()
      );
    }

    // public getWiningNumbersForRound(): UInt32[] {
    //   return mockWinningCombination.map((val) => UInt32.from(val));
    //   // // Temporary function implementation. Later will be switch with oracle call.
    //   // return generateNumbersSeed(Field(12345));
    // }

    /**
     * @notice Check validiy of merkle map witness for result tree.
     *
     * @param witness Merkle map witness for result tree.
     * @param round Optional value for round. If provided - checks, that round match key in <witness>.
     * @param curValue Value of result to be checked.
     *
     * @returns key of <witness>
     */
    public checkResult(
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

    /**
     * @notice Check validiy of merkle map witness for bank tree.
     *
     * @param witness Merkle map witness for bank tree.
     * @param round Round number, that will be compared with <witness> key.
     * @param curValue Value of bank to be checked.
     *
     * @returns key of <witness>
     */
    public checkBank(
      witness: MerkleMap20Witness,
      round: Field,
      curValue: Field
    ): MerkleCheckResult {
      return this.checkMap(this.bankRoot, witness, round, curValue);
    }

    /**
     * @notice Check validiy of merkle map witness for bank tree and then updates tree with new value.
     *
     * @param witness Merkle map witness for bank tree.
     * @param round Round number, that will be compared with <witness> key.
     * @param curValue Value of bank to be checked.
     * @param newValue New value that should be store in tree.
     *
     * @returns key of <witness>
     */
    public checkAndUpdateBank(
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

    /**
     * @notice Check validiy of merkle map witness for nullifier tree and then updates tree with new value.
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
      key: Field | null,
      curValue: Field,
      newValue: Field
    ): MerkleCheckResult {
      let checkRes = this.checkMap(state, witness, key, curValue);

      const [newRoot] = witness.computeRootAndKey(newValue);
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

    public checkAndUpdateTicket(
      firstWitness: MerkleMap20Witness | MerkleMapWitness,
      // key1: Field | null,
      secondWitness: MerkleMap20Witness | MerkleMapWitness,
      // key2: Field, For know second level key is not checked as later it would transform to merkle map
      prevValue: Field,
      newValue: Field
    ): { ticketId: Field; round: Field } {
      const res = this.checkTicket(
        firstWitness,
        // key1,
        secondWitness,
        prevValue
      );

      const [newRoot2] = secondWitness.computeRootAndKey(newValue);
      const [newRoot1] = firstWitness.computeRootAndKey(newRoot2);
      this.ticketRoot.set(newRoot1);

      return res;
    }

    /**
     * @notice Methods to check if ticket lies on ticket merkle tree.
     * @dev We can't use ordinary checkMap, because of two level stracture of ticket tree.
     *
     * @param firstWitness First level witness for ticket tree.
     * @param key1 First level key for ticket tree(round).
     * @param secondWitness Second level witness for ticket tree.
     * @param value Hash of ticket.
     *
     * @returns key of <witness>
     */
    public checkTicket(
      firstWitness: MerkleMap20Witness | MerkleMapWitness,
      // key1: Field | null,
      secondWitness: MerkleMap20Witness | MerkleMapWitness,
      // key2: Field, For know second level key is not checked as later it would transform to merkle map
      value: Field
    ): { ticketId: Field; round: Field; roundRoot: Field } {
      const [secondLevelRoot, ticketId] =
        secondWitness.computeRootAndKey(value);

      const [firstLevelRoot, round] =
        firstWitness.computeRootAndKey(secondLevelRoot);

      // if (key1) {
      //   round.assertEquals(key1, 'Wrong round');
      // }
      this.ticketRoot
        .getAndRequireEquals()
        .assertEquals(firstLevelRoot, 'Wrong 2d witness');

      return { ticketId, round, roundRoot: secondLevelRoot };
    }
  }

  return PLottery;
}

export type PLotteryType = InstanceType<ReturnType<typeof getPLottery>>;
