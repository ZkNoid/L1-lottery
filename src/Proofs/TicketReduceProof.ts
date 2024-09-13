import {
  Field,
  MerkleList,
  Poseidon,
  Provable,
  SelfProof,
  Struct,
  UInt64,
  ZkProgram,
} from 'o1js';
import { Ticket } from '../Structs/Ticket.js';
import { MerkleMap20Witness } from '../Structs/CustomMerkleMap.js';
import { TICKET_PRICE } from '../constants.js';

// https://github.com/o1-labs/o1js-bindings/blob/71f2e698dadcdfc62c76a72248c0df71cfd39d4c/lib/binable.ts#L317
let encoder = new TextEncoder();

function stringToBytes(s: string) {
  return [...encoder.encode(s)];
}

function prefixToField<Field>(
  // Field: GenericSignableField<Field>,
  Field: any,
  prefix: string
) {
  let fieldSize = Field.sizeInBytes;
  if (prefix.length >= fieldSize) throw Error('prefix too long');
  let stringBytes = stringToBytes(prefix);
  return Field.fromBytes(
    stringBytes.concat(Array(fieldSize - stringBytes.length).fill(0))
  );
}

// hashing helpers taken from https://github.com/o1-labs/o1js/blob/72a2779c6728e80e0c9d1462020347c954a0ffb5/src/lib/mina/events.ts#L28
function initialState() {
  return [Field(0), Field(0), Field(0)] as [Field, Field, Field];
}
function salt(prefix: string) {
  return Poseidon.update(initialState(), [prefixToField(Field, prefix)]);
}
function hashWithPrefix(prefix: string, input: Field[]) {
  let init = salt(prefix);
  return Poseidon.update(init, input)[0];
}
function emptyHashWithPrefix(prefix: string) {
  return salt(prefix)[0];
}

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
  initialTicketId: Field,
  newTicketRoot: Field,
  newBankRoot: Field,
  processedActionList: Field,
  lastProcessedRound: Field,
  lastProcessedTicketId: Field,
}) {}

export const init = async (
  input: TicketReduceProofPublicInput,
  initialState: Field,
  initialTicketRoot: Field,
  initialBankRoot: Field,
  initialRound: Field,
  initialTicketId: Field
): Promise<TicketReduceProofPublicOutput> => {
  return new TicketReduceProofPublicOutput({
    initialState,
    finalState: initialState,
    initialTicketRoot,
    initialBankRoot,
    initialTicketId,
    newTicketRoot: initialTicketRoot,
    newBankRoot: initialBankRoot,
    processedActionList: ActionList.emptyHash,
    lastProcessedRound: initialRound,
    lastProcessedTicketId: initialTicketId,
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

  let [prevRoundRoot, ticketId] = input.roundTicketWitness.computeRootAndKeyV2(
    Field(0)
  );

  let [prevTicketRoot, round] =
    input.roundWitness.computeRootAndKeyV2(prevRoundRoot);

  let expectedTicketId = Provable.if(
    round.greaterThan(prevProof.publicOutput.lastProcessedRound),
    Field(0),
    prevProof.publicOutput.lastProcessedTicketId.add(1)
  );

  ticketId.assertEquals(expectedTicketId, 'Wrong id for ticket');

  prevTicketRoot.assertEquals(
    prevProof.publicOutput.newTicketRoot,
    'Wrong ticket root'
  );
  round.assertEquals(input.action.round, 'Wrong round in witness');

  // Update root
  let [newTicketRoundRoot] = input.roundTicketWitness.computeRootAndKeyV2(
    input.action.ticket.hash()
  );

  let [newTicketRoot] =
    input.roundWitness.computeRootAndKeyV2(newTicketRoundRoot);

  let [prevBankRoot, bankKey] = input.bankWitness.computeRootAndKeyV2(
    input.bankValue
  );
  bankKey.assertEquals(round, 'Wrong bankKey');

  prevBankRoot.assertEquals(
    prevProof.publicOutput.newBankRoot,
    'Wrong bank root'
  );

  let [newBankRoot] = input.bankWitness.computeRootAndKeyV2(
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
    initialTicketId: prevProof.publicOutput.initialTicketId,
    newTicketRoot,
    newBankRoot,
    processedActionList,
    lastProcessedRound: round,
    lastProcessedTicketId: expectedTicketId,
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
    initialTicketId: prevProof.publicOutput.initialTicketId,
    newTicketRoot: prevProof.publicOutput.newTicketRoot,
    newBankRoot: prevProof.publicOutput.newBankRoot,
    processedActionList,
    lastProcessedRound: prevProof.publicOutput.lastProcessedRound,
    lastProcessedTicketId: prevProof.publicOutput.lastProcessedTicketId,
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
      privateInputs: [Field, Field, Field, Field, Field],
      async method(
        input: TicketReduceProofPublicInput,
        initialState: Field,
        initialTicketRoot: Field,
        initialBankRoot: Field,
        initialRound: Field,
        initialTicketId: Field
      ): Promise<TicketReduceProofPublicOutput> {
        return init(
          input,
          initialState,
          initialTicketRoot,
          initialBankRoot,
          initialRound,
          initialTicketId
        );
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
        return cutActions(input, prevProof);
      },
    },
  },
});

export class TicketReduceProof extends ZkProgram.Proof(TicketReduceProgram) {}
