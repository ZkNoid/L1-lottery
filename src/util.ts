import { Field, Gadgets, MerkleMap, Poseidon, UInt32, UInt64 } from 'o1js';
import { MerkleMap20 } from './Structs/CustomMerkleMap.js';
import { PackedUInt32Factory } from 'o1js-pack';

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
