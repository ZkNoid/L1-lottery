import {
  Field,
  MerkleList,
  Poseidon,
  SelfProof,
  Struct,
  ZkProgram,
} from 'o1js';
import { Ticket } from './Ticket';
import { MerkleMap20Witness } from './CustomMerkleMap';
import { TICKET_PRICE } from './constants';
import { emptyHashWithPrefix } from 'o1js/dist/node/lib/provable/crypto/poseidon';

export class LotteryAction extends Struct({
  ticket: Ticket,
  round: Field,
}) {}

export const actionListAdd = (hash: Field, action: LotteryAction): Field => {
  return Poseidon.hashWithPrefix('MinaZkappSeqEvents**', [
    hash,
    Poseidon.hashWithPrefix(
      'MinaZkappEvent******',
      LotteryAction.toFields(action)
    ),
  ]);
};

export class ActionList extends MerkleList.create(
  LotteryAction,
  actionListAdd,
  emptyHashWithPrefix('MinaZkappActionsEmpty')
) {}

export const merkleActionsAdd = (hash: Field, actionsHash: Field): Field => {
  return Poseidon.hashWithPrefix('MinaZkappSeqEvents**', [hash, actionsHash]);
};

export class MerkleActions extends MerkleList.create(
  ActionList.provable,
  (hash, x) => merkleActionsAdd(hash, x.hash),
  emptyHashWithPrefix('MinaZkappActionStateEmptyElt')
) {}

export class TicketReduceProofPublicInput extends Struct({
  action: LotteryAction,
  roundWitness: MerkleMap20Witness,
  roundTicketWitness: MerkleMap20Witness,
  bankWitness: MerkleMap20Witness,
  bankValue: Field,
}) {}

export class TicketReduceProofPublicOutput extends Struct({
  initialState: Field,
  finalState: Field,
  initialTicketRoot: Field,
  initialBankRoot: Field,
  newTicketRoot: Field,
  newBankRoot: Field,
  processedActionList: Field,
}) {}

export const init = async (
  input: TicketReduceProofPublicInput,
  initialState: Field,
  initialTicketRoot: Field,
  initialBankRoot: Field
): Promise<TicketReduceProofPublicOutput> => {
  return new TicketReduceProofPublicOutput({
    initialState,
    finalState: initialState,
    initialTicketRoot,
    initialBankRoot,
    newTicketRoot: initialTicketRoot,
    newBankRoot: initialBankRoot,
    processedActionList: ActionList.emptyHash,
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

  let [prevRoundRoot, ticketId] = input.roundTicketWitness.computeRootAndKey(
    Field(0)
  );

  //#TODO constrain ticketId + ticketId > 0

  let [prevTicketRoot, round] =
    input.roundWitness.computeRootAndKey(prevRoundRoot);

  prevTicketRoot.assertEquals(
    prevProof.publicOutput.newTicketRoot,
    'Wrong ticket root'
  );
  round.assertEquals(input.action.round, 'Wrong round in witness');

  // Update root
  let [newTicketRoundRoot] = input.roundTicketWitness.computeRootAndKey(
    input.action.ticket.hash()
  );

  let [newTicketRoot] =
    input.roundWitness.computeRootAndKey(newTicketRoundRoot);

  let [prevBankRoot, bankKey] = input.bankWitness.computeRootAndKey(
    input.bankValue
  );
  bankKey.assertEquals(round, 'Wrong bankKey');

  prevBankRoot.assertEquals(
    prevProof.publicOutput.newBankRoot,
    'Wrong bank root'
  );

  let [newBankRoot] = input.bankWitness.computeRootAndKey(
    input.bankValue.add(TICKET_PRICE.mul(input.action.ticket.amount).value)
  );

  let processedActionList = actionListAdd(
    prevProof.publicOutput.processedActionList,
    input.action
  );

  return new TicketReduceProofPublicOutput({
    initialState: prevProof.publicOutput.initialState,
    finalState: prevProof.publicOutput.finalState,
    initialTicketRoot: prevProof.publicOutput.initialTicketRoot,
    initialBankRoot: prevProof.publicOutput.initialBankRoot,
    newTicketRoot,
    newBankRoot,
    processedActionList,
  });
};

export const cutActions = async (
  input: TicketReduceProofPublicInput,
  prevProof: SelfProof<
    TicketReduceProofPublicInput,
    TicketReduceProofPublicOutput
  >
): Promise<TicketReduceProofPublicOutput> => {
  prevProof.verify();

  let finalState = merkleActionsAdd(
    prevProof.publicOutput.finalState,
    prevProof.publicOutput.processedActionList
  );
  let processedActionList = ActionList.emptyHash;

  return new TicketReduceProofPublicOutput({
    initialState: prevProof.publicOutput.initialState,
    finalState,
    initialTicketRoot: prevProof.publicOutput.initialTicketRoot,
    initialBankRoot: prevProof.publicOutput.initialBankRoot,
    newTicketRoot: prevProof.publicOutput.newTicketRoot,
    newBankRoot: prevProof.publicOutput.newBankRoot,
    processedActionList,
  });
};

/*
  init: simple initializer, create empty proof
  addTicket: process next ticket, updates roots of merkle tries. Add actions to processedActionList merkleList
  cutActions: updates finalState by adding processedActionList to finalState merkle list
*/
export const TicketReduceProgram = ZkProgram({
  name: 'ticket-reduce-program',
  publicInput: TicketReduceProofPublicInput,
  publicOutput: TicketReduceProofPublicOutput,
  methods: {
    init: {
      privateInputs: [Field, Field, Field],
      async method(
        input: TicketReduceProofPublicInput,
        initialState: Field,
        initialTicketRoot: Field,
        initialBankRoot: Field
      ): Promise<TicketReduceProofPublicOutput> {
        return init(input, initialState, initialTicketRoot, initialBankRoot);
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
    cutActions: {
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
