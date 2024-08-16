import {
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
  method,
  state,
} from 'o1js';
import { BLOCK_PER_ROUND } from '../constants.js';
import { convertToUInt32 } from '../util.js';

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

export const hashPart1 = Field(0);
export const hashPart2 = Field(1);

// Add events

export function getRandomManager(owner: PublicKey) {
  class RandomManager extends SmartContract {
    @state(Field) commitRoot = State<Field>();
    @state(Field) resultRoot = State<Field>();

    @state(Field) curRandomValue = State<Field>();
    @state(UInt32) startSlot = State<UInt32>();

    @state(PublicKey) coordinator = State<PublicKey>();

    // events = {
    //   requested: ExternalRequestEvent,
    // };

    init() {
      super.init();

      this.commitRoot.set(emptyMapRoot);
      this.resultRoot.set(emptyMapRoot);
    }

    @method async setStartSlot(startSlot: UInt32) {
      this.permissionCheck();

      this.startSlot.getAndRequireEquals().assertEquals(UInt32.from(0));
      this.startSlot.set(startSlot);
    }

    @method async commit(
      commitValue: CommitValue,
      commitWitness: MerkleMapWitness
    ) {
      this.permissionCheck();

      const [prevCommitRoot, round] = commitWitness.computeRootAndKey(Field(0));

      this.checkRoundDoNotEnd(convertToUInt32(round));

      this.commitRoot
        .getAndRequireEquals()
        .assertEquals(prevCommitRoot, 'commit: Wrong commit witness');

      const [newCommitRoot] = commitWitness.computeRootAndKey(
        commitValue.hash()
      );
      this.commitRoot.set(newCommitRoot);
    }

    @method async reveal(
      commitValue: CommitValue,
      commitWitness: MerkleMapWitness,
      resultWitness: MerkleMapWitness
    ) {
      this.permissionCheck();

      // Check VRF computed
      const curRandomValue = this.curRandomValue.getAndRequireEquals();
      curRandomValue.assertGreaterThan(
        Field(0),
        'reveal: No random value in stash'
      );

      // Check commit witness
      const [prevCommitRoot, round] = commitWitness.computeRootAndKey(
        commitValue.hash()
      );

      this.commitRoot
        .getAndRequireEquals()
        .assertEquals(prevCommitRoot, 'reveal: Wrong commit witness');

      // Check result witness
      const [prevResultRoot, resultRound] = resultWitness.computeRootAndKey(
        Field(0)
      );

      this.resultRoot
        .getAndRequireEquals()
        .assertEquals(prevResultRoot, 'reveal: wrong result witness');

      round.assertEquals(
        resultRound,
        'reveal: Round for commit and result should be equal'
      );

      // Check round is over
      this.checkRoundPass(convertToUInt32(round));

      // Compute result
      const resultValue = Poseidon.hash([commitValue.value, curRandomValue]);

      // Update result
      const [newResultRoot] = resultWitness.computeRootAndKey(resultValue);
      this.resultRoot.set(newResultRoot);

      // Consume random value
      this.curRandomValue.set(Field(0));
    }

    @method async callZkon() {
      const coordinatorAddress = this.coordinator.getAndRequireEquals();
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

    @method
    async receiveZkonResponse(requestId: Field, proof: ZkonProof) {
      let curRandomValue = this.curRandomValue.getAndRequireEquals();
      curRandomValue.assertEquals(
        Field(0),
        'receiveZkonResponse: prev random value was not consumed. Call reveal first'
      );

      const coordinatorAddress = this.coordinator.getAndRequireEquals();
      const coordinator = new ZkonRequestCoordinator(coordinatorAddress);
      await coordinator.recordRequestFullfillment(requestId, proof);
      this.curRandomValue.set(proof.publicInput.dataField);
    }

    public permissionCheck() {
      this.sender.getAndRequireSignature().assertEquals(owner);
    }

    public checkRoundPass(round: UInt32) {
      const startBlock = this.startSlot.getAndRequireEquals();
      this.network.globalSlotSinceGenesis.requireBetween(
        startBlock.add(round.add(1).mul(BLOCK_PER_ROUND)),
        UInt32.MAXINT()
      );
    }

    public checkRoundDoNotEnd(round: UInt32) {
      const startBlock = this.startSlot.getAndRequireEquals();
      this.network.globalSlotSinceGenesis.requireBetween(
        UInt32.from(0),
        startBlock.add(round.add(1).mul(BLOCK_PER_ROUND))
      );
    }
  }

  return RandomManager;
}

export function getMockedRandomManager(owner: PublicKey) {
  class MockedRandomManager extends getRandomManager(owner) {
    @method async mockReceiveZkonResponse(newValue: Field) {
      this.curRandomValue.set(newValue);
    }
  }

  return MockedRandomManager;
}

export type RandomManagerType = InstanceType<
  ReturnType<typeof getRandomManager>
>;
export type MockedRandomManagerType = InstanceType<
  ReturnType<typeof getMockedRandomManager>
>;
