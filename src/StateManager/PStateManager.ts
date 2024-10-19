import { Field } from 'o1js';
import { Ticket } from '../Structs/Ticket.js';
import { TICKET_PRICE } from '../constants.js';
import { MerkleMap20, MerkleMap20Witness } from '../Structs/CustomMerkleMap.js';
import {
  addTicket as TRaddTicket,
  LotteryAction,
  TicketReduceProgram,
  TicketReduceProof,
  TicketReduceProofPublicInput,
  init as TRinit,
  cutActions,
  refund,
} from '../Proofs/TicketReduceProof.js';
import { BaseStateManager } from './BaseStateManager.js';
import { BuyTicketEvent, PLottery, RefundEvent } from '../PLottery.js';

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
  contract: PLottery;
  processedTicketData: {
    ticketId: number;
    round: number;
  };

  constructor(
    plottery: PLottery,
    isMock: boolean = true,
    shouldUpdateState: boolean = false
  ) {
    super(plottery, isMock, shouldUpdateState);

    this.contract = plottery;
    this.processedTicketData = {
      ticketId: -1,
      round: 0,
    };
  }

  override addTicket(ticket: Ticket, forceUpdate: boolean = false) {
    if (this.shouldUpdateState || forceUpdate) {
      this.ticketMap.set(Field.from(this.lastTicketInRound), ticket.hash());
    }

    this.roundTickets.push(ticket);
    this.lastTicketInRound++;
  }

  async removeLastTicket() {
    const ticket = this.roundTickets.pop()!;
    this.lastTicketInRound--;
    this.ticketMap.set(Field.from(this.lastTicketInRound - 1), Field(0)); // ?
  }

  async reduceTickets(
    winningNumberPacked: Field,
    actionLists?: LotteryAction[][],
    updateState: boolean = true
  ): Promise<TicketReduceProof> {
    let addedTicketInfo = [];

    if (!actionLists) {
      actionLists = await this.contract.reducer.fetchActions({});
    }

    // All this params can be random for init function, because init do not use them
    let input = new TicketReduceProofPublicInput({
      action: new LotteryAction({
        ticket: Ticket.random(this.contract.address),
      }),
      ticketWitness: new MerkleMap20().getWitness(Field(0)),
    });

    let curProof = this.isMock
      ? await mockProof(
          await TRinit(input, winningNumberPacked),
          TicketReduceProof,
          input
        )
      : await TicketReduceProgram.init(input, winningNumberPacked);

    let ticketId = 0;
    for (let actionList of actionLists) {
      for (let action of actionList) {
        console.log(`Process ticket: <${ticketId}>`);

        input = new TicketReduceProofPublicInput({
          action: action,
          ticketWitness: this.ticketMap.getWitness(Field(ticketId)),
        });

        curProof = this.isMock
          ? await mockProof(
              await TRaddTicket(input, curProof),
              TicketReduceProof,
              input
            )
          : await TicketReduceProgram.addTicket(input, curProof);

        this.addTicket(action.ticket, true);
        addedTicketInfo.push({});
        ticketId++;
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

    const events = await this.contract.fetchEvents();
    const refundTicketsEvents = events
      .filter((event) => event.type === 'get-refund')
      // @ts-ignore
      .map((event) => event.event.data as RefundEvent);

    for (const refundEvent of refundTicketsEvents) {
      console.log(`Remove ticket: <${refundEvent.ticketId.toString()}>`);
      const input = new TicketReduceProofPublicInput({
        action: new LotteryAction({
          ticket: refundEvent.ticket,
        }),
        ticketWitness: this.ticketMap.getWitness(refundEvent.ticketId),
      });
      curProof = this.isMock
        ? await mockProof(
            await refund(input, curProof),
            TicketReduceProof,
            input
          )
        : await TicketReduceProgram.refund(input, curProof);

      this.ticketMap.set(refundEvent.ticketId, Field(0));
    }

    if (!updateState) {
      addedTicketInfo.forEach((v) => this.removeLastTicket());
    }

    return curProof;
  }
}
