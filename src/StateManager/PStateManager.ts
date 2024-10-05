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
import { PLottery } from '../PLottery.js';

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
        round: Field(0),
      }),
      ticketWitness: this.ticketMap.getWitness(Field(0)),
    });

    let initialTicketRoot = this.ticketMap.getRoot();
    let initialBank = this.contract.bank.get();

    let curProof = this.isMock
      ? await mockProof(
          await TRinit(input, initialTicketRoot, initialBank),
          TicketReduceProof,
          input
        )
      : await TicketReduceProgram.init(input, initialTicketRoot, initialBank);

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
          ticketWitness: this.ticketMap.getWitness(
            Field(this.processedTicketData.ticketId)
          ),
        });

        curProof = this.isMock
          ? await mockProof(
              await TRaddTicket(input, curProof),
              TicketReduceProof,
              input
            )
          : await TicketReduceProgram.addTicket(input, curProof);

        this.addTicket(action.ticket, true);
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
      addedTicketInfo.forEach((v) => this.removeLastTicket());
    }

    return curProof;
  }
}
