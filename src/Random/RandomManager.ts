import {
  Bool,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Poseidon,
  PublicKey,
  SmartContract,
  State,
  Struct,
  UInt32,
  ZkProgram,
  assert,
  method,
  state,
} from 'o1js';
import { BLOCK_PER_ROUND, ZkOnCoordinatorAddress } from '../constants.js';
import {
  ZkonZkProgram,
  ZkonRequestCoordinator,
  ExternalRequestEvent,
} from 'zkon-zkapp';

const emptyMapRoot = new MerkleMap().getRoot();

export let ZkonProof_ = ZkProgram.Proof(ZkonZkProgram);
export class ZkonProof extends ZkonProof_ {}

export class CommitValue extends Struct({
  value: Field,
  salt: Field,
}) {
  hash(): Field {
    return Poseidon.hash([this.value, this.salt]);
  }
}

const coordinatorAddress = ZkOnCoordinatorAddress;
const owner = PublicKey.fromBase58(
  'B62qjGsPY47SMkTykivPBAU3riS9gvMMrGr7ve6ynoHJNBzAhQmtoBn'
);

export class RandomManager extends SmartContract {
  // Do not change order of storage, as it would affect deployment via factory
  @state(UInt32) startSlot = State<UInt32>();
  @state(Field) commit = State<Field>();
  @state(Field) result = State<Field>();
  @state(Field) curRandomValue = State<Field>();
  @state(Field) requestFirstPart = State<Field>();
  @state(Field) requestSecondPart = State<Field>();

  events = {
    requested: ExternalRequestEvent,
  };

  /**
   * @notice Commit hidden value.
   * @dev Only hash o value and salt is stored. So value is hidden.
   *
   * @param commitValue Commit value = value + slot.
   *
   */
  @method async commitValue(commitValue: CommitValue) {
    this.permissionCheck();

    // this.checkRoundPass();

    const currentCommit = this.commit.getAndRequireEquals();
    currentCommit.assertEquals(Field(0), 'Already committed');

    this.commit.set(commitValue.hash());

    await this.callZkon();
  }
  /*

  /**
   * @notice Reveal number committed previously.
   * @dev This function can be called only after oracle provided its random value
   *
   * @param commitValue Commit value = value + slot.
   *
   */
  @method async reveal(commitValue: CommitValue) {
    this.permissionCheck();

    const result = this.result.getAndRequireEquals();
    result.assertEquals(Field(0), 'reveal: Result already computed');

    // Check VRF computed
    const curRandomValue = this.curRandomValue.getAndRequireEquals();
    // Check is ommitted for a while
    curRandomValue.assertGreaterThan(Field(0), 'reveal: No random value');

    // Check commit
    const commit = this.commit.getAndRequireEquals();
    commit.assertEquals(commitValue.hash(), 'reveal: wrong commit value');

    // Check round is over
    this.checkRoundPass();

    // Compute result
    const resultValue = Poseidon.hash([commitValue.value, curRandomValue]);

    // Update result
    this.result.set(resultValue);
  }

  /**
   * @notice Sends request to ZKOn oracle.
   * @dev Request body is stored on IPFS.
   *
   */
  public async callZkon() {
    const hashPart1 = this.requestFirstPart.getAndRequireEquals();
    const hashPart2 = this.requestSecondPart.getAndRequireEquals();
    const coordinator = new ZkonRequestCoordinator(coordinatorAddress);

    const requestId = await coordinator.sendRequest(
      this.address,
      hashPart1,
      hashPart2
    );

    const event = new ExternalRequestEvent({
      id: requestId,
      hash1: hashPart1,
      hash2: hashPart2,
    });

    this.emitEvent('requested', event);
  }

  /**
   * @notice Callback function for ZKOn response
   *
   */
  @method
  async receiveZkonResponse(requestId: Field, proof: ZkonProof) {
    let curRandomValue = this.curRandomValue.getAndRequireEquals();
    curRandomValue.assertEquals(
      Field(0),
      'receiveZkonResponse: prev random value was not consumed. Call reveal first'
    );

    const coordinator = new ZkonRequestCoordinator(coordinatorAddress);
    await coordinator.recordRequestFullfillment(requestId, proof);
    this.curRandomValue.set(proof.publicInput.dataField);
  }

  /**
   * @notice Checks that sender is the owner of the contract.
   *
   */
  public permissionCheck() {
    // this.sender.getAndRequireSignatureV2().assertEquals(owner);
  }

  /**
   * @notice Checks that specified round have already passed.
   *
   * @param round Round to check
   */
  public checkRoundPass() {
    const startSlot = this.startSlot.getAndRequireEquals();
    this.network.globalSlotSinceGenesis.requireBetween(
      startSlot.add(BLOCK_PER_ROUND),
      UInt32.MAXINT()
    );
  }
}

export default RandomManager;
