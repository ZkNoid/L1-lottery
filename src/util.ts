import * as fs from 'fs';

import {
  Field,
  Gadgets,
  InferProvable,
  MerkleMap,
  Poseidon,
  Provable,
  provable,
  Struct,
  UInt32,
  UInt64,
} from 'o1js';
import { MerkleMap20 } from './Structs/CustomMerkleMap.js';
// import { PackedUInt32Factory } from 'o1js-pack';
import { StringCircuitValue } from 'zkon-zkapp';

const MAX_BITS_PER_FIELD = 254n;
const L = 7; // 7 32-bit uints fit in one Field
const SIZE_IN_BITS = 32n;

export function PackingPlant<A, T extends InferProvable<A> = InferProvable<A>>(
  elementType: A,
  l: number,
  bitSize: bigint
) {
  if (bitSize * BigInt(l) > MAX_BITS_PER_FIELD) {
    throw new Error(
      `The Packing Plant is only accepting orders that can fit into one Field, try using MultiPackingPlant`
    );
  }
  abstract class Packed_ extends Struct({
    packed: Field,
  }) {
    static type = provable({ packed: Field }, {});
    static l: number = l;
    static bitSize: bigint = bitSize;

    constructor(packed: Field) {
      super({ packed });
    }

    // Must implement these in type-specific implementation
    static extractField(input: T): Field {
      throw new Error('Must implement extractField');
    }
    static sizeInBits(): bigint {
      throw new Error('Must implement sizeInBits');
    }
    static unpack(f: Field): Array<T> {
      throw new Error('Must implement unpack');
    }
    // End

    /**
     *
     * @param unpacked Array of the implemented packed type
     * @throws if the length of the array is longer than the length of the implementing factory config
     */
    static checkPack(unpacked: Array<T>) {
      if (unpacked.length > l) {
        throw new Error(
          `Input of size ${unpacked.length} is larger than expected size of ${l}`
        );
      }
    }

    /**
     *
     * @param unpacked Array of the implemented packed type, must be shorter than the max allowed, which varies by type, will throw if the input is too long
     * @returns Field, packed with the information from the unpacked input
     */
    static pack(unpacked: Array<T>): Field {
      this.checkPack(unpacked);
      let f = this.extractField(unpacked[0]);
      const n = Math.min(unpacked.length, l);
      for (let i = 1; i < n; i++) {
        const c = Field((2n ** this.sizeInBits()) ** BigInt(i));
        f = f.add(this.extractField(unpacked[i]).mul(c));
      }
      return f;
    }

    /**
     *
     * @param f Field, packed with the information, as returned by #pack
     * @returns Array of bigints, which can be decoded by the implementing class into the final type
     */
    static unpackToBigints(f: Field): Array<bigint> {
      let unpacked = new Array(l);
      unpacked.fill(0n);
      let packedN;
      if (f) {
        packedN = f.toBigInt();
      } else {
        throw new Error('No Packed Value Provided');
      }
      for (let i = 0; i < l; i++) {
        unpacked[i] = packedN & ((1n << this.sizeInBits()) - 1n);
        packedN >>= this.sizeInBits();
      }
      return unpacked;
    }

    // NOTE: adding to fields here breaks the proof generation.  Probably not overriding it correctly
    /**
     * @returns array of single Field element which constitute the packed object
     */
    toFields(): Array<Field> {
      return [this.packed];
    }

    assertEquals(other: Packed_) {
      this.packed.assertEquals(other.packed);
    }
  }
  return Packed_;
}

export function PackedUInt32Factory(l: number = L) {
  class PackedUInt32_ extends PackingPlant(UInt32, l, SIZE_IN_BITS) {
    static extractField(input: UInt32): Field {
      return input.value;
    }

    static sizeInBits(): bigint {
      return SIZE_IN_BITS;
    }

    /**
     *
     * @param f Field, packed with the information, as returned by #pack
     * @returns Array of UInt32
     */
    static unpack(f: Field): UInt32[] {
      const unpacked = Provable.witness(Provable.Array(UInt32, l), () => {
        const unpacked = this.unpackToBigints(f);
        return unpacked.map((x) => UInt32.from(x));
      });
      f.assertEquals(PackedUInt32_.pack(unpacked));
      return unpacked;
    }

    /**
     *
     * @param uint32s Array of UInt32s to be packed
     * @returns Instance of the implementing class
     */
    static fromUInt32s(uint32s: Array<UInt32>): PackedUInt32_ {
      const packed = PackedUInt32_.pack(uint32s);
      return new PackedUInt32_(packed);
    }

    /**
     *
     * @param bigints Array of bigints to be packed
     * @returns Instance of the implementing class
     */
    static fromBigInts(bigints: Array<bigint>): PackedUInt32_ {
      const uint32s = bigints.map((x) => UInt32.from(x));
      return PackedUInt32_.fromUInt32s(uint32s);
    }

    toBigInts(): Array<bigint> {
      return PackedUInt32_.unpack(this.packed).map((x) => x.toBigint());
    }
  }
  return PackedUInt32_;
}

export class NumberPacked extends PackedUInt32Factory() {}

export function convertToUInt64(value: Field): UInt64 {
  let val = UInt64.Unsafe.fromField(value);
  UInt64.check(val);

  return val;
}

export function convertToUInt32(value: Field): UInt32 {
  let val = UInt32.Unsafe.fromField(value);
  UInt32.check(val);

  return val;
}

export const getIPFSCID = (): { hashPart1: Field; hashPart2: Field } => {
  function segmentHash(ipfsHashFile: string) {
    const ipfsHash0 = ipfsHashFile.slice(0, 30); // first part of the ipfsHash
    const ipfsHash1 = ipfsHashFile.slice(30); // second part of the ipfsHash

    const hashPart1 = new StringCircuitValue(ipfsHash0).toField();

    const hashPart2 = new StringCircuitValue(ipfsHash1).toField();

    return { hashPart1, hashPart2 };
  }

  let cidBuffer = fs.readFileSync('./random_request_cid');

  return segmentHash(cidBuffer.toString());
};
