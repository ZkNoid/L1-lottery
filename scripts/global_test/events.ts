import { Field, MerkleList, Mina, PrivateKey, PublicKey, UInt32 } from 'o1js';
import {
  NumberPacked,
  PLotteryType,
  PStateManager,
  Ticket,
  generateNumbersSeed,
} from '../../src';
import { randomInt } from 'crypto';
import { LotteryAction } from '../../src/Proofs/TicketReduceProof';
import { RandomManagerType } from '../../build/src/Random/RandomManager';
import { RandomManagerManager } from '../../src/StateManager/RandomManagerManager';

const PLAYERS_AMOUNT = 10;

const generatePlayers = () => {
  return [...Array(PLAYERS_AMOUNT)].map(() => PrivateKey.randomKeypair());
};

const players = generatePlayers();

interface TicketInfo {
  ticket: Ticket;
  round: Field;
}

class Context {
  lottery: PLotteryType;
  randomManager: RandomManagerType;
  lotterySM: PStateManager;
  randomManagerSM: RandomManagerManager;

  boughtTickets: TicketInfo[];
  usedTickets: TicketInfo[];
}

class Deviation {
  name: string;
  field: string;
  probability: number;
  expectedError: string | undefined;
  apply: () => Promise<void>;
}

type Account = {
  publicKey: PublicKey;
  privateKey: PrivateKey;
};

abstract class TestEvent {
  activeDeviations: Deviation[];
  sender: Account;
  context: Context;

  constructor(context: Context, sender: Account) {
    this.context = context;
    this.sender = sender;
  }

  static async randomValid(context: Context): Promise<TestEvent> {
    throw Error('unimplemented');
  }
  abstract getDeviations(): Deviation[];
  addDeviation(deviation: Deviation) {
    this.activeDeviations.push(deviation);
    deviation.apply();
  }

  async safeInvoke() {
    try {
      await this.invoke();
    } catch (e) {
      if (e != this.activeDeviations[0].expectedError) {
        throw Error('Unhandled error');
      }
    }
  }
  abstract invoke(): Promise<void>;

  async checkedInoke() {
    let shouldFail = this.activeDeviations.length > 0;
    try {
      await this.invoke();
    } catch (e) {
      if (shouldFail) {
        console.log(`Expected error ${e} occured`);
        return;
      }
      throw Error(`Unexpected error ${e} occured`);
    }

    if (shouldFail) {
      throw Error(`Expected error, but nothing heppen`);
      return;
    }
  }
}

class BuyTicketEvent extends TestEvent {
  ownerIndex: number;
  ticket: Ticket;
  round: Field;

  constructor(context: Context, ownerIndex: number, ticket: Ticket) {
    super(context, players[ownerIndex]);
    this.ownerIndex = ownerIndex;
    this.ticket = ticket;
  }

  static override async randomValid(context: Context): Promise<BuyTicketEvent> {
    const ownerIndex = randomInt(PLAYERS_AMOUNT);
    const owner = players[ownerIndex];
    const ticket = Ticket.random(owner.publicKey);

    return new BuyTicketEvent(context, ownerIndex, ticket);
  }

  getDeviations(): Deviation[] {
    return [
      {
        name: 'wrong numbers',
        field: 'ticket',
        probability: 0.1,
        apply: async () => {
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
        apply: async () => {
          this.sender = players[(this.ownerIndex + randomInt(1, 10)) % 10];
        },
        expectedError: '????',
      },
      {
        name: 'wrong round',
        field: 'round',
        probability: 0.1,
        apply: async () => {
          // 50/50 less or greater
          if (Math.random() > 0.5) {
            this.round = Field(randomInt(+this.round + 1, +this.round + 1000));
          } else {
            this.round = Field(randomInt(+this.round));
          }
        },
        expectedError: '????',
      },
    ];
  }

  async invoke() {
    let tx = Mina.transaction(this.sender.publicKey, async () => {
      await this.context.lottery.buyTicket(this.ticket, this.round);
    });

    await tx.prove();
    await tx.sign([this.sender.privateKey]).send();
  }
}

// class RefundTicketEvent extends TestEvent {}

class RedeemTicketEvent extends TestEvent {
  round: Field;
  ticket: Ticket;

  constructor(context: Context, round: Field, ticket: Ticket) {
    super(context, players[randomInt(players.length)]);
    this.round = round;
    this.ticket = ticket;
  }

  static override async randomValid(
    context: Context
  ): Promise<RedeemTicketEvent> {
    const { ticket, round } =
      context.boughtTickets[randomInt(context.boughtTickets.length)];

    return new RedeemTicketEvent(context, round, ticket);
  }

  getDeviations(): Deviation[] {
    return [
      {
        name: 'used ticket',
        field: 'ticket',
        probability: 0.1,
        apply: async () => {
          const { ticket, round } =
            this.context.boughtTickets[
              randomInt(this.context.boughtTickets.length)
            ];

          this.round = round;
          this.ticket = ticket;
        },
        expectedError: '????',
      },
    ];
  }

  async invoke() {
    const rp = await this.context.lotterySM.getReward(+this.round, this.ticket);
    let tx = await Mina.transaction(this.sender.publicKey, async () => {
      await this.context.lottery.getReward(
        this.ticket,
        rp.roundWitness,
        rp.roundTicketWitness,
        rp.dp,
        rp.winningNumbers,
        rp.resultWitness,
        rp.bankValue,
        rp.bankWitness,
        rp.nullifierWitness
      );
    });

    await tx.prove();
    await tx.sign([this.sender.privateKey]).send();

    // Change bought ticket to used one
  }
}

// class RandomValueGenerationEvent extends TestEvent {}

class ProduceResultEvent extends TestEvent {
  round: Field;
  randomRound: Field;

  constructor(context: Context, round: Field) {
    super(context, players[randomInt(players.length)]);
    this.round = round;
    this.randomRound = round;
  }

  getDeviations(): Deviation[] {
    return [
      {
        name: 'round-have-not-started',
        field: 'round',
        probability: 0.1,
        expectedError: '???',
        apply: async () => {
          this.activeDeviations = this.activeDeviations.filter(
            (v) => v.field != 'round'
          );

          this.round = Field(randomInt(+this.round + 1, +this.round + 1000));
        },
      },

      {
        name: 'round-has-result',
        field: 'round',
        probability: 0.1,
        expectedError: '???',
        apply: async () => {
          this.activeDeviations = this.activeDeviations.filter(
            (v) => v.field != 'round'
          );

          this.round = Field(randomInt(+this.round));
        },
      },

      {
        name: 'wrong-random-round',
        field: 'randomRound',
        probability: 0.1,
        expectedError: '???',
        apply: async () => {
          let deviantRound = randomInt(+this.round * 2);
          while (deviantRound == +this.round) {
            deviantRound = randomInt(+this.round * 2);
          }
          this.randomRound = Field(deviantRound);
        },
      },
    ];
  }

  async invoke() {
    const resultWV = this.context.randomManagerSM.getResultWitness(
      this.randomRound
    );

    const { resultWitness, bankValue, bankWitness } =
      this.context.lotterySM.updateResult(
        this.round,
        NumberPacked.pack(generateNumbersSeed(resultWV.value))
      );

    let tx = Mina.transaction(this.sender.publicKey, async () => {
      await this.context.lottery.produceResult(
        resultWitness,
        bankValue,
        bankWitness,
        resultWV.witness,
        resultWV.value
      );
    });

    await tx.prove();
    await tx.sign([this.sender.privateKey]).send();
  }
}

class ReduceTicketsEvent extends TestEvent {
  fromState: Field;
  toState: Field;
  actions: LotteryAction[][];

  constructor(
    context: Context,
    sender: Account,
    fromState: Field,
    toState: Field,
    actions: LotteryAction[][]
  ) {
    super(context, sender);
    this.fromState = fromState;
    this.toState = toState;
    this.actions = actions;
  }

  static override async randomValid(
    context: Context
  ): Promise<ReduceTicketsEvent> {
    const randomSender = players[randomInt(players.length)];
    const fromState = context.lottery.lastProcessedState.get();
    const toState = context.lottery.account.actionState.get();
    const actions = await context.lottery.reducer.fetchActions({
      fromActionState: fromState,
      endActionState: toState,
    });

    return new ReduceTicketsEvent(
      context,
      randomSender,
      fromState,
      toState,
      actions
    );
  }

  getDeviations(): Deviation[] {
    return [
      {
        name: 'wrong fromState',
        field: 'fromState',
        probability: 0.1,
        expectedError: '???',
        apply: async () => {
          this.fromState = this.toState; // Chenge to one step jump
          this.actions = await this.context.lottery.reducer.fetchActions({
            fromActionState: this.fromState,
            endActionState: this.toState,
          });
        },
      },
      {
        name: 'wrong actions',
        field: 'actions',
        probability: 0.1,
        expectedError: '???',
        apply: async () => {
          let firstIndex = randomInt(this.actions.length);
          let secondIndex = randomInt(
            this.actions[randomInt(firstIndex)].length
          );
          this.actions[firstIndex][secondIndex].ticket.numbers[0] =
            this.actions[firstIndex][secondIndex].ticket.numbers[0]
              .add(1)
              .mod(10)
              .add(1);
        },
      },
    ];
  }

  async invoke() {
    const shouldFail = this.activeDeviations.length > 0;
    let reduceProof = await this.context.lotterySM.reduceTickets(
      this.fromState,
      this.actions,
      !shouldFail
    );

    let tx = Mina.transaction(this.sender.publicKey, async () => {
      await this.context.lottery.reduceTickets(reduceProof);
    });

    await tx.prove();
    await tx.sign([this.sender.privateKey]).send();
  }
}

const events = [BuyTicketEvent, ReduceTicketsEvent];

export class TestOperator {
  async invokeNextEvent(context: Context) {
    const eventType = events[randomInt(events.length)];
    const event = await eventType.randomValid(context);
    const deviations = event.getDeviations();
    deviations.forEach((deviation) => {
      if (deviation.probability > Math.random()) {
        event.addDeviation(deviation);
      }
    });
    await event.invoke();
  }
}
