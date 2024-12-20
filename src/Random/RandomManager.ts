import {
  Bool,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Poseidon,
  Provable,
  PublicKey,
  SmartContract,
  State,
  Struct,
  UInt32,
  method,
  state,
} from 'o1js';
import { BLOCK_PER_ROUND } from '../constants.js';

export class CommitValue extends Struct({
  value: Field,
  salt: Field,
}) {
  hash(): Field {
    return Poseidon.hash([this.value, this.salt]);
  }
}

// #TODO change to actual address
const firstPartyAddress = PublicKey.fromBase58(
  'B62qryLwDWH5TM4N65Cs9S3jWqyDgC9JYXr5kc87ua8NFB5enpiuT1Y'
);
const secondPartyAddress = PublicKey.fromBase58(
  'B62qnSztu3Gp49AR6AWAEUERBVSnoWDFJTki5taYUY7ig9hR1ut1a6r'
);

export class RandomManager extends SmartContract {
  // Do not change order of storage, as it would affect deployment via factory
  @state(UInt32) startSlot = State<UInt32>();
  @state(Field) firstCommit = State<Field>();
  @state(Field) secondCommit = State<Field>();
  @state(Field) firstValue = State<Field>();
  @state(Field) secondValue = State<Field>();
  @state(Field) result = State<Field>();

  @method async firstPartyCommit(value: CommitValue) {
    this.firstCommit.getAndRequireEquals().assertEquals(Field(0));
    value.value.assertGreaterThan(0, 'Value should be > 0');
    this.checkPermission(firstPartyAddress);

    this.firstCommit.set(value.hash());
  }

  @method async secondPartyCommit(value: CommitValue) {
    this.secondCommit.getAndRequireEquals().assertEquals(Field(0));
    value.value.assertGreaterThan(0, 'Value should be > 0');
    this.checkPermission(secondPartyAddress);

    this.secondCommit.set(value.hash());
  }

  @method async revealFirstCommit(value: CommitValue) {
    this.checkRoundPass();
    const storedCommit = this.firstCommit.getAndRequireEquals();
    storedCommit.assertEquals(
      value.hash(),
      'Reveal failed: Commit does not match stored value.'
    );

    this.firstValue.set(value.value);
    const secondValue = this.secondValue.getAndRequireEquals();

    this.produceResultIfAllRevealed(value.value, secondValue);
  }

  @method async revealSecondCommit(value: CommitValue) {
    this.checkRoundPass();
    const storedCommit = this.secondCommit.getAndRequireEquals();
    storedCommit.assertEquals(
      value.hash(),
      'Reveal failed: Commit does not match stored value.'
    );

    const firstValue = this.firstValue.getAndRequireEquals();
    this.secondValue.set(value.value);

    this.produceResultIfAllRevealed(firstValue, value.value);
  }

  public produceResultIfAllRevealed(firstValue: Field, secondValue: Field) {
    const allRevealed = firstValue
      .greaterThan(Field(0))
      .and(secondValue.greaterThan(Field(0)));
    const result = Poseidon.hash([firstValue, secondValue]);
    const resultToStore = Provable.if(allRevealed, result, Field(0));

    this.result.set(resultToStore);
  }

  public checkPermission(targetAddress: PublicKey) {
    this.sender.getAndRequireSignatureV2().assertEquals(targetAddress);
  }

  public checkRoundPass() {
    const startSlot = this.startSlot.getAndRequireEquals();
    this.network.globalSlotSinceGenesis.requireBetween(
      startSlot.add(BLOCK_PER_ROUND),
      UInt32.MAXINT()
    );
  }
}

export default RandomManager;
