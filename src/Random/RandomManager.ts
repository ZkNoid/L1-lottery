import {
  Field,
  MerkleMap,
  MerkleMapWitness,
  Poseidon,
  PublicKey,
  SmartContract,
  State,
  UInt32,
  method,
  state,
} from 'o1js';
import { treasury } from '../private_constants';
import { BLOCK_PER_ROUND } from '../constants';

const emptyMapRoot = new MerkleMap().getRoot();

export class RandomManager extends SmartContract {
  @state(Field) commitRoot = State<Field>();

  @state(Field) hashCommitRoot = State<Field>();

  @state(Field) resultRoot = State<Field>();

  @state(UInt32) startSlot = State<UInt32>();

  init() {
    super.init();

    this.commitRoot.set(emptyMapRoot);
    this.hashCommitRoot.set(emptyMapRoot);
    this.resultRoot.set(emptyMapRoot);

    this.startSlot.set(
      this.network.globalSlotSinceGenesis.getAndRequireEquals()
    );
  }

  /*
   * Can we update value
   * What we will do if value is wrong?
   */
  @method async commitValue(witness: MerkleMapWitness, value: Field) {
    this.permissionCheck();

    const [prevCommitRoot, round] = witness.computeRootAndKey(Field(0));

    prevCommitRoot.assertEquals(
      this.commitRoot.getAndRequireEquals(),
      'Wrong commit witness'
    );

    this.checkRoundDoNotEnd(UInt32.fromFields([round]));

    const [newCommitRoot] = witness.computeRootAndKey(value);

    this.commitRoot.set(newCommitRoot);
  }

  @method async commitBlockHash(witness: MerkleMapWitness) {
    const [prevBlockCommitRoot, key] = witness.computeRootAndKey(Field(0));

    prevBlockCommitRoot.assertEquals(
      this.hashCommitRoot.getAndRequireEquals(),
      'Wrong witness for hashCommits'
    );

    this.checkRoundPass(UInt32.fromFields([key]));

    const newValue = Poseidon.hash([
      this.network.snarkedLedgerHash.get(),
      this.network.globalSlotSinceGenesis.getAndRequireEquals().value,
    ]);
    const [newBlockCommitRoot] = witness.computeRootAndKey(newValue);

    this.hashCommitRoot.set(newBlockCommitRoot);
  }
  /*
  @method async produceValue(
    commitWitness: MerkleMapWitness,
    commitValue: Field,
    revealValue: Field,
    salt: Field,
    blockHashCommitWitness: MerkleMapWitness,
    blockHashValue: Field,
    blockHashProof: BlockHashProof
  ) {
    const [commitRoot, commitKey] =
      commitWitness.computeRootAndKey(commitValue);

    commitRoot.assertEquals(
      this.commitRoot.getAndRequireEquals(),
      'Wrong commit witness'
    );

    Poseidon.hash([revealValue, salt]).assertEquals(
      commitValue,
      'Wrong reveal'
    );

    const [blockHashCommitRoot, blockHashCommitKey] =
      blockHashCommitWitness.computeRootAndKey(blockHashValue);

    blockHashCommitRoot.assertEquals(
      this.hashCommitRoot.getAndRequireEquals(),
      'Wrong hash commit witness'
    );

    commitKey.assertEquals(
      blockHashCommitKey,
      'Different rounds for commit and hash commit'
    );

    blockHashProof.verify();

    // Check blockHashProof initialHash to equal blockHashValue

    // Check that blockHashProof final block is right slot

    // Call lottery contract
  }

  */

  private permissionCheck() {
    this.sender.getAndRequireSignature().assertEquals(treasury);
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
