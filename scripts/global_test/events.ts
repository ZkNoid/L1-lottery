import { Field, Mina, PrivateKey, PublicKey, UInt32 } from 'o1js';
import { PLotteryType, Ticket } from '../../src';
import { randomInt } from 'crypto';

const PLAYERS_AMOUNT = 10;

const generatePlayers = () => {
  return [...Array(PLAYERS_AMOUNT)].map(() => PrivateKey.randomKeypair());
};

const players = generatePlayers();

class Context {}

class Deviation {
  name: string;
  field: string;
  probability: number;
  expectedError: string;
  apply: () => void;
}

abstract class TestEvent {
  activeDeviations: Deviation[];

  static random(): TestEvent {
    throw Error('unimplemented');
  }
  abstract getDeviations(): Deviation[];
  addDeviation(deviation: Deviation) {
    this.activeDeviations.push(deviation);
    deviation.apply();
  }

  async safeInvoke(zkApp: PLotteryType) {
    try {
      await this.invoke(zkApp);
    } catch (e) {
      if (e != this.activeDeviations[0].expectedError) {
        throw Error('Unhandled error');
      }
    }
  }
  abstract invoke(zkApp: PLotteryType): Promise<void>;
}

class BuyTicketEvent extends TestEvent {
  ownerIndex: number;
  sender: {
    publicKey: PublicKey;
    privateKey: PrivateKey;
  };
  ticket: Ticket;
  round: Field;

  constructor(ticket: Ticket) {
    super();
    this.ticket = ticket;
  }

  random() {
    const owner = players[randomInt(PLAYERS_AMOUNT)];
    const ticket = Ticket.random(owner.publicKey);

    throw Error('unimplemented');
  }

  getDeviations(): Deviation[] {
    return [
      {
        name: 'wrong numbers',
        field: 'ticket',
        probability: 0.1,
        apply: () => {
          this.ticket.numbers[randomInt(6)] = UInt32.from(
            randomInt(10, +UInt32.MAXINT)
          );
        },
        expectedError: '????',
      },
      {
        name: 'wrong owner',
        field: 'sender',
        probability: 0.1,
        apply: () => {
          this.sender = players[(this.ownerIndex + randomInt(1, 10)) % 10];
        },
        expectedError: '????',
      },
    ];
  }

  async invoke(lottery: PLotteryType) {
    let tx = Mina.transaction(this.ticket.owner, async () => {
      await lottery.buyTicket(this.ticket, this.round);
    });

    await tx.prove();
    await tx.sign([this.sender.privateKey]).send();
  }
}

class RefundTicketEvent extends TestEvent {}

class RedeemTicketEvent extends TestEvent {}

class ProduceResultEvent extends TestEvent {}

class ReduceTicketsEvent extends TestEvent {}

const events = [BuyTicketEvent];

export class TestOperator {
  async invokeNextEvent(lottery: PLotteryType) {
    const eventType = events[randomInt(events.length)];
    const event = eventType.random();
    const deviations = event.getDeviations();
    deviations.forEach((deviation) => {
      if (deviation.probability > Math.random()) {
        event.addDeviation(deviation);
      }
    });
    await event.invoke(lottery);
  }
}
