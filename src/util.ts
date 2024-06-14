import { MerkleMap, Poseidon } from 'o1js';
import { PackedUInt32Factory } from './o1js-pack/Packed.js';
import { MerkleMap20 } from './CustomMerkleMap.js';

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
