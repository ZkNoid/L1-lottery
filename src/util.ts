import * as fs from 'fs';

import { Field, Gadgets, MerkleMap, Poseidon, UInt32, UInt64 } from 'o1js';
import { MerkleMap20 } from './Structs/CustomMerkleMap.js';
import { PackedUInt32Factory } from 'o1js-pack';
import { StringCircuitValue } from 'zkon-zkapp';

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
