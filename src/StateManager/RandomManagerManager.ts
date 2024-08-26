/// Best fucking naming

import { Field, MerkleMap, MerkleMapWitness } from 'o1js';
import { CommitValue } from '../Random/RandomManager';

interface WitnessedValue {
  value: Field;
  witness: MerkleMapWitness;
}

export class RandomManagerManager {
  commitMap: MerkleMap;
  resultMap: MerkleMap;
  commits: { [key: number]: CommitValue };
  results: { [key: number]: Field };

  constructor() {
    this.commitMap = new MerkleMap();
    this.resultMap = new MerkleMap();
    this.commits = {};
    this.results = {};
  }

  getCommitWitness(round: number | Field): WitnessedValue {
    round = Field(round);

    return {
      value: this.commitMap.get(round),
      witness: this.commitMap.getWitness(round),
    };
  }

  addCommit(round: number | Field, commit: CommitValue) {
    round = Field(round);
    if (this.commits[+round]) {
      throw Error(`You have already commited to round ${+round}`);
    }

    this.commits[+round] = commit;
    this.commitMap.set(round, commit.hash());
  }

  getResultWitness(round: number | Field): WitnessedValue {
    round = Field(round);

    return {
      value: this.resultMap.get(round),
      witness: this.resultMap.getWitness(round),
    };
  }

  addResultValue(round: number | Field, value: Field) {
    round = Field(round);

    if (this.results[+round]) {
      throw Error(`You already have result in round: ${+round}`);
    }

    this.results[+round] = value;

    this.resultMap.set(round, value);
  }

  toJSON(): string {
    const json = {
      commits: Object.entries(this.commits).map(([round, commitValue]) => {
        return {
          round,
          value: commitValue.value.toString(),
          salt: commitValue.salt.toString(),
        };
      }),

      results: Object.entries(this.results).map(([round, resultValue]) => {
        return {
          round,
          result: resultValue.toString(),
        };
      }),
    };

    return JSON.stringify(json);
  }

  static fromJSON(s: string): RandomManagerManager {
    const data = JSON.parse(s);

    const res = new RandomManagerManager();

    data.commits.forEach((commit: any) => {
      res.addCommit(
        Field(commit.round),
        new CommitValue({
          value: Field(commit.value),
          salt: Field(commit.salt),
        })
      );
    });

    data.results.forEach((result: any) => {
      res.addResultValue(Field(result.round), Field(result.result));
    });

    return res;
  }
}
