import {
  Bool,
  Field,
  Gadgets,
  MerkleMap,
  MerkleTree,
  MerkleWitness,
  Poseidon,
  Provable,
} from 'o1js';
import {
  CircuitValue,
  arrayProp,
} from 'o1js/dist/node/lib/provable/types/circuit-value';
import { BinableFp } from 'o1js/dist/node/mina-signer/src/field-bigint';

// Based on Merkle Map implementation - https://github.com/o1-labs/o1js/blob/main/src/lib/provable/merkle-map.ts
// But allows to pick arbitrary height

export function CustomMerkleMap(height: number): typeof MerkleMap {
  if (height > 256) {
    throw new Error('CustomMerkleMap error: Max tree length is 256');
  }

  class CustomMerkleMapWitness extends CircuitValue {
    @arrayProp(Bool, height - 1) isLefts: Bool[];
    @arrayProp(Field, height - 1) siblings: Field[];

    constructor(isLefts: Bool[], siblings: Field[]) {
      super();
      this.isLefts = isLefts;
      this.siblings = siblings;
    }

    /**
     * computes the merkle tree root for a given value and the key for this witness
     * @param value The value to compute the root for.
     * @returns A tuple of the computed merkle root, and the key that is connected to the path updated by this witness.
     */
    computeRootAndKey(value: Field) {
      let hash = value;

      const isLeft = this.isLefts;
      const siblings = this.siblings;

      let key = Field(0);

      for (let i = 0; i < height - 1; i++) {
        const left = Provable.if(isLeft[i], hash, siblings[i]);
        const right = Provable.if(isLeft[i], siblings[i], hash);
        hash = Poseidon.hash([left, right]);

        const bit = Provable.if(isLeft[i], Field(0), Field(1));

        key = key.mul(2).add(bit);
      }

      return [hash, key];
    }
  }

  return class CustomMerkleMap {
    tree: MerkleTree;

    /**
     * Creates a new, empty Merkle Map.
     * @returns A new MerkleMap
     */
    constructor() {
      this.tree = new MerkleTree(height);
    }

    _keyToIndex(key: Field) {
      Gadgets.rangeCheckN(height - 1, key);
      // the bit map is reversed to make reconstructing the key during proving more convenient
      let bits = BinableFp.toBits(key.toBigInt()).reverse();

      let n = 0n;
      for (let i = bits.length - 1; i >= 0; i--) {
        n = (n << 1n) | BigInt(bits[i]);
      }

      return n;
    }

    /**
     * Sets a key of the merkle map to a given value.
     * @param key The key to set in the map.
     * @param value The value to set.
     */
    set(key: Field, value: Field) {
      const index = this._keyToIndex(key);
      this.tree.setLeaf(index, value);
    }

    /**
     * Returns a value given a key. Values are by default Field(0).
     * @param key The key to get the value from.
     * @returns The value stored at the key.
     */
    get(key: Field) {
      const index = this._keyToIndex(key);
      return this.tree.getNode(0, index);
    }

    /**
     * Returns the root of the Merkle Map.
     * @returns The root of the Merkle Map.
     */
    getRoot() {
      return this.tree.getRoot();
    }

    /**
     * Returns a circuit-compatible witness (also known as [Merkle Proof or Merkle Witness](https://computersciencewiki.org/index.php/Merkle_proof)) for the given key.
     * @param key The key to make a witness for.
     * @returns A MerkleMapWitness, which can be used to assert changes to the MerkleMap, and the witness's key.
     */
    getWitness(key: Field) {
      const index = this._keyToIndex(key);
      class MyMerkleWitness extends MerkleWitness(height) {}
      const witness = new MyMerkleWitness(this.tree.getWitness(index));
      return new CustomMerkleMapWitness(witness.isLeft, witness.path);
    }
  };
}
