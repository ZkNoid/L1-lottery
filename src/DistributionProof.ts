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

export class DistributionProofPublicInput extends Struct({
  winingCombination: Provable.Array(Field, NUMBERS_IN_TICKET),
  ticket: Ticket,
  valueWitness: MerkleMapWitness,
}) {}

export class DistributionProofPublicOutput extends Struct({
  root: Field,
  total: Field,
}) {}

const emptyMap = new MerkleMap();
const emptyMapRoot = emptyMap.getRoot();

const DistibutionProgram = ZkProgram({
  name: 'distribution-program',
  publicInput: DistributionProofPublicInput,
  publicOutput: DistributionProofPublicOutput,
  methods: {
    init: {
      privateInputs: [],
      async method(): Promise<DistributionProofPublicOutput> {
        return new DistributionProofPublicOutput({
          root: emptyMapRoot,
          total: Field.from(0),
        });
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
        prevProof.verify();

        const [initialRoot, key] = input.valueWitness.computeRootAndKey(
          Field(0)
        );
        key.assertEquals(input.ticket.hash(), 'Wrong key for that ticket');
        initialRoot.assertEquals(prevProof.publicOutput.root);

        const newValue = input.ticket.hash();

        const [newRoot] = input.valueWitness.computeRootAndKey(newValue);
        const ticketScore = input.ticket.getScore(input.winingCombination);

        return new DistributionProofPublicOutput({
          root: newRoot,
          total: prevProof.publicOutput.total.add(ticketScore),
        });
      },
    },
  },
});

export class DistributionProof extends ZkProgram.Proof(DistibutionProgram) {}
