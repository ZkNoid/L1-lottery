import { Field, method } from 'o1js';
import { RandomManager } from '../../Random/RandomManager';

export class MockedRandomManager extends RandomManager {
  @method async mockReceiveZkonResponse(randomValue: Field) {
    this.curRandomValue.set(randomValue);
  }
}
