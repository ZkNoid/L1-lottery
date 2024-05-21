import { Field, SmartContract, state, State, method } from 'o1js';

export class Lottery extends SmartContract {
  @state(Field) ticketRoot = State<Field>();
  @state(Field) ticketAmountRoot = State<Field>();
  @state(Field) roundResultRoot = State<Field>();

  init() {
    super.init();

    // #TODO Permisions
  }

  @method async buyTicket(ticketHash: Field, amount: Field) {
    // #TODO
  }

  @method async produceResult(round: Field) {
    // #TODO
  }

  @method async getReward(ticketHash: Field) {
    // #TODO
  }
}
