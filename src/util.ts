import { MerkleMap, Poseidon } from 'o1js';

export const getEmpty2dMerkleMap = () => {
  const emptyMapRoot = new MerkleMap().getRoot();
  const empty2dMap = new MerkleMap();

  empty2dMap.tree.zeroes[0] = emptyMapRoot;
  for (let i = 1; i < empty2dMap.tree.height; i++) {
    empty2dMap.tree.zeroes[i] = Poseidon.hash([
      empty2dMap.tree.zeroes[i - 1],
      empty2dMap.tree.zeroes[i - 1],
    ]);
  }

  return empty2dMap;
};
