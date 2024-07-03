import { Field, SelfProof, Struct, ZkProgram } from 'o1js';

export class TicketReduceProofPublicInput extends Struct({}) {}

export class TicketReduceProofPublicOutput extends Struct({
  initialState: Field,
  finalState: Field,
  newTicketRoot: Field,
  newBankRoot: Field,
}) {}

export const init = async (
  input: TicketReduceProofPublicInput,
  initialState: Field
): Promise<TicketReduceProofPublicOutput> => {
  return new TicketReduceProofPublicOutput({
    initialState,
    finalState: initialState,
    newTicketRoot: Field(0), // #TODO
    newBankRoot: Field(0), // #TODO
  });
};

export const addTicket = async (
  input: TicketReduceProofPublicInput,
  prevProof: SelfProof<
    TicketReduceProofPublicInput,
    TicketReduceProofPublicOutput
  >
): Promise<TicketReduceProofPublicOutput> => {
  prevProof.verify();

  return new TicketReduceProofPublicOutput({
    initialState: prevProof.publicOutput.initialState,
    finalState: prevProof.publicOutput.initialState,
    newTicketRoot: Field(0), // #TODO
    newBankRoot: Field(0), // #TODO
  });
};

export const TicketReduceProgram = ZkProgram({
  name: 'distribution-program',
  publicInput: TicketReduceProofPublicInput,
  publicOutput: TicketReduceProofPublicOutput,
  methods: {
    init: {
      privateInputs: [Field],
      async method(
        input: TicketReduceProofPublicInput,
        initialState: Field
      ): Promise<TicketReduceProofPublicOutput> {
        return init(input, initialState);
      },
    },
    addTicket: {
      privateInputs: [SelfProof],
      async method(
        input: TicketReduceProofPublicInput,
        prevProof: SelfProof<
          TicketReduceProofPublicInput,
          TicketReduceProofPublicOutput
        >
      ) {
        return addTicket(input, prevProof);
      },
    },
  },
});

export class TicketReduceProof extends ZkProgram.Proof(TicketReduceProgram) {}
