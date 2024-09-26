import { Field } from 'o1js';
import { Ticket } from '../Structs/Ticket.js';
import { TICKET_PRICE } from '../constants.js';
import { MerkleMap20Witness } from '../Structs/CustomMerkleMap.js';
import {
  addTicket as TRaddTicket,
  LotteryAction,
  TicketReduceProgram,
  TicketReduceProof,
  TicketReduceProofPublicInput,
  init as TRinit,
  cutActions,
} from '../Proofs/TicketReduceProof.js';
import { BaseStateManager } from './BaseStateManager.js';
import { PLotteryType } from '../PLottery.js';

export async function mockProof<I, O, P>(
  publicOutput: O,
  ProofType: new ({
    proof,
    publicInput,
    publicOutput,
    maxProofsVerified,
  }: {
    proof: unknown;
    publicInput: I;
    publicOutput: any;
    maxProofsVerified: 0 | 2 | 1;
  }) => P,
  publicInput: I
): Promise<P> {
  // const [, proof] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
  return new ProofType({
    proof: null as any,
    maxProofsVerified: 2,
    publicInput,
    publicOutput,
  });
}

export class PStateManager extends BaseStateManager {
  contract: PLotteryType;
  processedTicketData: {
    ticketId: number;
    round: number;
  };

  constructor(
    plottery: PLotteryType,
    startBlock: Field,
    isMock: boolean = true,
    shouldUpdateState: boolean = false
  ) {
    super(startBlock, isMock, shouldUpdateState);

    this.contract = plottery;
    this.processedTicketData = {
      ticketId: -1,
      round: 0,
    };
  }

  override addTicket(
    ticket: Ticket,
    round: number,
    forceUpdate: boolean = false
  ): [MerkleMap20Witness, MerkleMap20Witness, MerkleMap20Witness, Field] {
    const [roundWitness, ticketRoundWitness] = this.getNextTicketWitness(round);
    const [bankWitness, bankValue] = this.getBankWitness(round);

    if (this.shouldUpdateState || forceUpdate) {
      this.roundTicketMap[round].set(
        Field.from(this.lastTicketInRound[round]),
        ticket.hash()
      );
      this.ticketMap.set(
        Field.from(round),
        this.roundTicketMap[round].getRoot()
      );

      this.bankMap.set(
        Field.from(round),
        bankValue.add(TICKET_PRICE.mul(ticket.amount).value)
      );
    }

    this.roundTickets[round].push(ticket);
    this.lastTicketInRound[round]++;

    return [roundWitness, ticketRoundWitness, bankWitness, bankValue];
  }

  async removeLastTicket(round: number) {
    const ticket = this.roundTickets[round].pop()!;
    this.lastTicketInRound[round]--;
    const bankValue = this.bankMap.get(Field.from(round));
    this.roundTicketMap[round].set(
      Field.from(this.lastTicketInRound[round] - 1),
      Field(0)
    );
    this.ticketMap.set(Field.from(round), this.roundTicketMap[round].getRoot());

    this.bankMap.set(
      Field.from(round),
      bankValue.sub(TICKET_PRICE.mul(ticket.amount).value)
    );
  }

  async reduceTickets(
    initialState?: Field,
    actionLists?: LotteryAction[][],
    updateState: boolean = true
  ): Promise<TicketReduceProof> {
    let addedTicketInfo = [];

    if (!initialState) {
      initialState = this.contract.lastProcessedState.get();
    }

    if (!actionLists) {
      actionLists = await this.contract.reducer.fetchActions({
        fromActionState: initialState,
      });
    }

    // All this params can be random for init function, because init do not use them
    let input = new TicketReduceProofPublicInput({
      action: new LotteryAction({
        ticket: Ticket.random(this.contract.address),
        round: Field(0),
      }),
      roundWitness: this.ticketMap.getWitness(Field(0)),
      roundTicketWitness: this.roundTicketMap[0].getWitness(Field(0)),
      bankWitness: this.bankMap.getWitness(Field(0)),
      bankValue: Field(0),
    });

    let initialTicketRoot = this.ticketMap.getRoot();
    let initialBankRoot = this.bankMap.getRoot();

    let curProof = this.isMock
      ? await mockProof(
          await TRinit(
            input,
            initialState,
            initialTicketRoot,
            initialBankRoot,
            Field.from(this.processedTicketData.round),
            Field.from(this.processedTicketData.ticketId)
          ),
          TicketReduceProof,
          input
        )
      : await TicketReduceProgram.init(
          input,
          initialState,
          initialTicketRoot,
          initialBankRoot,
          Field.from(this.processedTicketData.round),
          Field.from(this.processedTicketData.ticketId)
        );

    for (let actionList of actionLists) {
      for (let action of actionList) {
        if (+action.round != this.processedTicketData.round) {
          this.processedTicketData.round = +action.round;
          this.processedTicketData.ticketId = 0;
        } else {
          this.processedTicketData.ticketId++;
        }

        console.log(
          `Process ticket: <${+action.round}> <${
            this.processedTicketData.ticketId
          }>`
        );

        input = new TicketReduceProofPublicInput({
          action: action,
          roundWitness: this.ticketMap.getWitness(action.round),
          roundTicketWitness: this.roundTicketMap[+action.round].getWitness(
            Field(this.processedTicketData.ticketId)
          ),
          bankWitness: this.bankMap.getWitness(action.round),
          bankValue: this.bankMap.get(action.round),
        });

        curProof = this.isMock
          ? await mockProof(
              await TRaddTicket(input, curProof),
              TicketReduceProof,
              input
            )
          : await TicketReduceProgram.addTicket(input, curProof);

        this.addTicket(action.ticket, +action.round, true);
        addedTicketInfo.push({
          round: action.round,
        });
      }

      // Again here we do not need specific input, as it is not using here
      curProof = this.isMock
        ? await mockProof(
            await cutActions(input, curProof),
            TicketReduceProof,
            input
          )
        : await TicketReduceProgram.cutActions(input, curProof);
    }

    if (!updateState) {
      addedTicketInfo.forEach((v) => this.removeLastTicket(+v.round));
    }

    return curProof;
  }
}
