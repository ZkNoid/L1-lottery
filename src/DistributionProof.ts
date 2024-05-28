import {
  Field,
  Struct,
  Provable,
  MerkleMapWitness,
  ZkProgram,
  MerkleMap,
  SelfProof,
} from 'o1js';
import { NUMBERS_IN_TICKET } from './constants';
import { Ticket } from './Ticket';
import { NumberPacked } from './Lottery';

export class DistributionProofPublicInput extends Struct({
  winningCombination: Field,
  ticket: Ticket,
  valueWitness: MerkleMapWitness,
}) {}

export class DistributionProofPublicOutput extends Struct({
  root: Field,
  total: Field,
}) {}

const emptyMap = new MerkleMap();
const emptyMapRoot = emptyMap.getRoot();

export const init = async (
  input: DistributionProofPublicInput
): Promise<DistributionProofPublicOutput> => {
  return new DistributionProofPublicOutput({
    root: emptyMapRoot,
    total: Field.from(0),
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

  Provable.asProver(() => {
    console.log(
      `Ticket score of ${key.toString()} ticket is ${ticketScore.toString()}`
    );
  });

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
