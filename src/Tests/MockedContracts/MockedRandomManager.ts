import { Field, method } from 'o1js';
import { CommitValue, RandomManager } from '../../Random/RandomManager';

export class MockedRandomManager extends RandomManager {
  @method async mockReceiveZkonResponse(randomValue: Field) {
    this.curRandomValue.set(randomValue);
  }

  @method override async commitValue(commitValue: CommitValue) {
    this.permissionCheck();

    // this.checkRoundPass();

    const currentCommit = this.commit.getAndRequireEquals();
    currentCommit.assertEquals(Field(0), 'Already committed');

    this.commit.set(commitValue.hash());

    // await this.callZkon();
  }
}