import { Field, method, PublicKey } from 'o1js';
import { CommitValue, RandomManagerTwoParties } from '../../Random/RandomManagerTwoParties';

export class MockedRandomManager extends RandomManagerTwoParties {
  public checkPermission(address: PublicKey) {}
}