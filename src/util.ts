import {
  Field,
  Gadgets,
  MerkleMap,
  Poseidon,
  PublicKey,
  UInt32,
  UInt64,
  UInt8,
} from 'o1js';
import { PackedUInt32Factory } from './o1js-pack/Packed.js';
import { MerkleMap20 } from './CustomMerkleMap.js';
import { Ticket } from './Ticket.js';
import { COMMISION, PRESICION } from './constants.js';

export const getEmpty2dMerkleMap = (height?: number): MerkleMap => {
  let emptyMapRoot;
  let empty2dMap;
  if (height) {
    if (height != 20) {
      throw Error('Custom size merkle map is not supported yet. Only 20');
    }
    emptyMapRoot = new MerkleMap20().getRoot();
    empty2dMap = new MerkleMap20();
  } else {
    emptyMapRoot = new MerkleMap().getRoot();
    empty2dMap = new MerkleMap();
  }

  empty2dMap.tree.zeroes[0] = emptyMapRoot;
  for (let i = 1; i < empty2dMap.tree.height; i++) {
    empty2dMap.tree.zeroes[i] = Poseidon.hash([
      empty2dMap.tree.zeroes[i - 1],
      empty2dMap.tree.zeroes[i - 1],
    ]);
  }

  return empty2dMap as MerkleMap;
};

export class NumberPacked extends PackedUInt32Factory() {}

export const comisionTicket = Ticket.from(
  Array(6).fill(0),
  PublicKey.empty(),
  1
);

export function getTotalScoreAndCommision(value: UInt64) {
  return value.add(value.mul(COMMISION).div(PRESICION));
}

export function getNullifierId(round: Field, ticketId: Field): Field {
  Gadgets.rangeCheck64(round);
  Gadgets.rangeCheck64(ticketId);

  return Field.fromBits([...round.toBits(64), ...ticketId.toBits(64)]);
}

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
