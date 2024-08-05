/// Best fucking naming

import { Field, MerkleMap, MerkleMapWitness } from 'o1js';

interface WitnessedValue {
  value: Field;
  witness: MerkleMapWitness;
}

export class RandomManagerManager {
  commitMap: MerkleMap;
  resultMap: MerkleMap;

  constructor() {
    this.commitMap = new MerkleMap();
    this.resultMap = new MerkleMap();
  }

  getCommitWitness(round: number | Field): WitnessedValue {
    round = Field(round);

    return {
      value: this.commitMap.get(round),
      witness: this.commitMap.getWitness(round),
    };
  }

  updateCommitMap(round: number | Field, value: Field) {
    round = Field(round);
    this.commitMap.set(round, value);
  }

  getResultWitness(round: number | Field): WitnessedValue {
    round = Field(round);

    return {
      value: this.resultMap.get(round),
      witness: this.resultMap.getWitness(round),
    };
  }

  updateResultMap(round: number | Field, value: Field) {
    round = Field(round);
    this.resultMap.set(round, value);
  }
}
