import {
  Field,
  Struct,
  MerkleMapWitness,
  ZkProgram,
  MerkleMap,
  SelfProof,
} from 'o1js';
import { Ticket } from '../Structs/Ticket.js';
import { UInt64 } from 'o1js';
import { NumberPacked } from '../util.js';
import { MerkleMap20, MerkleMap20Witness } from '../Structs/CustomMerkleMap.js';

export class DistributionProofPublicInput extends Struct({
  winningCombination: Field,
  ticket: Ticket,
  valueWitness: MerkleMap20Witness,
}) {}

export class DistributionProofPublicOutput extends Struct({
  root: Field,
  total: UInt64,
}) {}

const emptyMap = new MerkleMap20();
const emptyMapRoot = emptyMap.getRoot();

// Initializer for proof
export const init = async (
  input: DistributionProofPublicInput
): Promise<DistributionProofPublicOutput> => {
  return new DistributionProofPublicOutput({
    root: emptyMapRoot,
    total: UInt64.from(0),
  });
};

export const addTicket = async (
  input: DistributionProofPublicInput,
  prevProof: SelfProof<
    DistributionProofPublicInput,
    DistributionProofPublicOutput
  >
): Promise<DistributionProofPublicOutput> => {
  prevProof.verify();

  const [initialRoot, key] = input.valueWitness.computeRootAndKey(Field(0));
  // key.assertEquals(input.ticket.hash(), 'Wrong key for that ticket');
  initialRoot.assertEquals(prevProof.publicOutput.root);

  const newValue = input.ticket.hash();

  const [newRoot] = input.valueWitness.computeRootAndKey(newValue);
  const ticketScore = input.ticket.getScore(
    NumberPacked.unpack(input.winningCombination)
  );

  return new DistributionProofPublicOutput({
    root: newRoot,
    total: prevProof.publicOutput.total.add(ticketScore),
  });
};

export const DistibutionProgram = ZkProgram({
  name: 'distribution-program',
  publicInput: DistributionProofPublicInput,
  publicOutput: DistributionProofPublicOutput,
  methods: {
    init: {
      privateInputs: [],
      async method(
        input: DistributionProofPublicInput
      ): Promise<DistributionProofPublicOutput> {
        return init(input);
      },
    },
    addTicket: {
      privateInputs: [SelfProof],
      async method(
        input: DistributionProofPublicInput,
        prevProof: SelfProof<
          DistributionProofPublicInput,
          DistributionProofPublicOutput
        >
      ) {
        return addTicket(input, prevProof);
      },
    },
  },
});

export class DistributionProof extends ZkProgram.Proof(DistibutionProgram) {}
