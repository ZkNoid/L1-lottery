/// Best fucking naming

import { Field, MerkleMap, MerkleMapWitness } from 'o1js';
import { CommitValue } from '../Random/RandomManager.js';
import RandomManager from '../Random/RandomManager.js';

interface WitnessedValue {
  value: Field;
  witness: MerkleMapWitness;
}

export class RandomManagerManager {
  commit: CommitValue | undefined;
  contract: RandomManager;

  constructor(contract: RandomManager) {
    this.contract = contract;
  }

  addCommit(commit: CommitValue) {
    if (this.commit) {
      throw Error(`You have already committed to round}`);
    }

    this.commit = commit;
  }

  toJSON(): string {
    const json = {
      commit: {
        salt: this.commit?.salt.toString(),
        value: this.commit?.value.toString(),
      },
    };

    return JSON.stringify(json);
  }

  // static fromJSON(s: string): RandomManagerManager {
  //   const data = JSON.parse(s);

  //   const res = new RandomManagerManager();

  //   res.addCommit(
  //     new CommitValue({
  //       value: Field(data.commit.value),
  //       salt: Field(data.commit.salt),
  //     })
  //   );

  //   return res;
  // }
}
