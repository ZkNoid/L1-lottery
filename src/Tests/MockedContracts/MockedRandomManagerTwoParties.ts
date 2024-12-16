import { Field, method, PublicKey } from 'o1js';
import { CommitValue, RandomManager } from '../../Random/RandomManagerTwoParties';

export class MockedRandomManager extends RandomManager {
  public checkPermission(address: PublicKey) {}
}