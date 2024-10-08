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
import { convertToUInt32 } from '../util.js';

import {
  ZkonZkProgram,
  ZkonRequestCoordinator,
  ExternalRequestEvent,
} from 'zkon-zkapp';
import { getIPFSCID } from '../../scripts/utils.js';

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

const { hashPart1, hashPart2 } = getIPFSCID();

const coordinatorAddress = ZkOnCoordinatorAddress;
const owner = PublicKey.empty(); // #TODO change with real owner address

export class RandomManager extends SmartContract {
  @state(UInt32) startSlot = State<UInt32>();
  @state(Field) commit = State<Field>();
  @state(Field) result = State<Field>();
  @state(Field) curRandomValue = State<Field>();

  events = {
    requested: ExternalRequestEvent,
  };

  // init() {
  //   super.init();

  //   // assert(
  //   //   Bool(false),
  //   //   'This contract is supposed to be deployed from factory. No init call there'
  //   // );
  // }

  /**
   * @notice Commit hidden value.
   * @dev Only hash o value and salt is stored. So value is hidden.
   *
   * @param commitValue Commit value = value + slot.
   *
   */
  @method async commitValue(commitValue: CommitValue) {
    this.permissionCheck();

    const currentCommit = this.commit.getAndRequireEquals();
    currentCommit.assertEquals(Field(0), 'Already committed');

    this.commit.set(commitValue.hash());
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
  @method async callZkon() {
    let curRandomValue = this.curRandomValue.getAndRequireEquals();
    curRandomValue.assertEquals(
      Field(0),
      'random value have already been computed'
    );

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
    // this.sender.getAndRequireSignature().assertEquals(owner);
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
