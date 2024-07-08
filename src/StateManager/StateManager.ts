import { Field } from 'o1js';
import { Ticket } from '../Ticket.js';
import { TICKET_PRICE } from '../constants.js';
import { MerkleMap20Witness } from '../CustomMerkleMap.js';
import { BaseStateManager } from './BaseStateManager.js';

export class StateManager extends BaseStateManager {
  override addTicket(
    ticket: Ticket,
    round: number
  ): [MerkleMap20Witness, MerkleMap20Witness, MerkleMap20Witness, Field] {
    const [roundWitness, ticketRoundWitness] = this.getNextTicketWitenss(round);
    const [bankWitness, bankValue] = this.getBankWitness(round);
    this.roundTicketMap[round].set(
      Field.from(this.lastTicketInRound[round]),
      ticket.hash()
    );
    this.roundTickets[round].push(ticket);
    this.lastTicketInRound[round]++;
    this.ticketMap.set(Field.from(round), this.roundTicketMap[round].getRoot());

    this.bankMap.set(
      Field.from(round),
      bankValue.add(TICKET_PRICE.mul(ticket.amount).value)
    );

    return [roundWitness, ticketRoundWitness, bankWitness, bankValue];
  }
}
