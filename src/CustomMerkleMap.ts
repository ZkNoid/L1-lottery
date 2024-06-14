import {
  Bool,
  Field,
  Gadgets,
  MerkleMap,
  MerkleMapWitness,
  MerkleTree,
  MerkleWitness,
  Poseidon,
  Provable,
  Struct,
} from 'o1js';

const LENGTH20 = 20;

export class MerkleMap20Witness extends Struct({
  isLefts: Provable.Array(Bool, LENGTH20 - 1),
  siblings: Provable.Array(Field, LENGTH20 - 1),
}) {
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

    for (let i = 0; i < LENGTH20 - 1; i++) {
      const left = Provable.if(isLeft[i], hash, siblings[i]);
      const right = Provable.if(isLeft[i], siblings[i], hash);
      hash = Poseidon.hash([left, right]);

      const bit = Provable.if(isLeft[i], Field(0), Field(1));

      key = key.mul(2).add(bit);
    }

    return [hash, key];
  }
}

export class MerkleMap20 {
  tree: MerkleTree;

  /**
   * Creates a new, empty Merkle Map.
   * @returns A new MerkleMap
   */
  constructor() {
    this.tree = new MerkleTree(LENGTH20);
  }

  _keyToIndex(key: Field) {
    // console.log('Key: ', key.toString());
    // the bit map is reversed to make reconstructing the key during proving more convenient
    // let bits = BinableFp.toBits(key.toBigInt()).reverse(); // original version
    let bits = key.toBits(LENGTH20 - 1).reverse(); // Can we just use BinableFP? It is used for constants anyway

    // console.log(bits.map((bit) => bit.toString()));
    // console.log(bits.map((bit) => bit.toField().toString()));

    let n = 0n;
    for (let i = bits.length - 1; i >= 0; i--) {
      n = (n << 1n) | BigInt(bits[i].toField().toString());
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
    class MyMerkleWitness extends MerkleWitness(LENGTH20) {}
    const witness = new MyMerkleWitness(this.tree.getWitness(index));
    // console.log('Witness in getWitness: ');
    // console.log(witness);
    return new MerkleMap20Witness({
      isLefts: witness.isLeft,
      siblings: witness.path,
    });
  }
}
