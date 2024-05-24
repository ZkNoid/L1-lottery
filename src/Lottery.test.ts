import {
  AccountUpdate,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Mina,
  PrivateKey,
  PublicKey,
} from 'o1js';
import { Lottery } from './Lottery';
import { Ticket } from './Ticket';
import { getEmpty2dMerkleMap } from './util';
import { TICKET_PRICE } from './constants';

/*
 * This file specifies how to test the `Add` example smart contract. It is safe to delete this file and replace
 * with your own tests.
 *
 * See https://docs.minaprotocol.com/zkapps for more info.
 */

// interface LeafValue<T = void> {
//   value: Field;
//   additionalInfo?: T;
// }

// class MapManager<T = void> {
//   map: MerkleMap;
//   values: { [key: number]: LeafValue<T> };

//   constructor() {
//     return {
//       map: new MerkleMap(),
//       values: {},
//     };
//   }
// }

class StateManager {
  ticketMap: MerkleMap;
  roundTicketMap: MerkleMap[];
  lastTicketInRound: number[];
  ticketNullifierMap: MerkleMap;
  bankMap: MerkleMap;
  roundResultMap: MerkleMap;
  startBlock: Field;

  constructor() {
    this.ticketMap = getEmpty2dMerkleMap();
    this.roundTicketMap = [new MerkleMap()];
    this.lastTicketInRound = [0];
    this.ticketNullifierMap = new MerkleMap();
    this.bankMap = new MerkleMap();
    this.roundResultMap = new MerkleMap();
  }

  getNextTicketWitenss(round: number): [MerkleMapWitness, MerkleMapWitness] {
    const roundWitness = this.ticketMap.getWitness(Field.from(round));
    const ticketRoundWitness = this.roundTicketMap[round].getWitness(
      Field.from(this.lastTicketInRound[round])
    );

    return [roundWitness, ticketRoundWitness];
  }

  addTicket(
    ticket: Ticket,
    round: number
  ): [MerkleMapWitness, MerkleMapWitness, MerkleMapWitness, Field] {
    const [roundWitness, ticketRoundWitness] = this.getNextTicketWitenss(round);
    const [bankWitness, bankValue] = this.getBankWitness(round);

    this.roundTicketMap[round].set(
      Field.from(this.lastTicketInRound[round]),
      ticket.hash()
    );
    this.lastTicketInRound[round]++;
    this.ticketMap.set(Field.from(round), this.roundTicketMap[round].getRoot());

    this.bankMap.set(
      Field.from(round),
      bankValue.add(TICKET_PRICE.mul(ticket.amount).value)
    );

    return [roundWitness, ticketRoundWitness, bankWitness, bankValue];
  }

  // Returns witness and value
  getBankWitness(round: number): [MerkleMapWitness, Field] {
    const bankWitness = this.bankMap.getWitness(Field.from(round));
    const value = this.bankMap.get(Field.from(round));

    return [bankWitness, value];
  }
}

let proofsEnabled = false;

describe('Add', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    lottery: Lottery,
    state: StateManager,
    checkConsistancy: () => void;

  beforeAll(async () => {
    if (proofsEnabled) await Lottery.compile();
  });

  beforeEach(async () => {
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    [deployerAccount, senderAccount] = Local.testAccounts;
    deployerKey = deployerAccount.key;
    senderKey = senderAccount.key;

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    lottery = new Lottery(zkAppAddress);
    state = new StateManager();

    checkConsistancy = () => {
      expect(lottery.ticketRoot.get()).toEqual(state.ticketMap.getRoot());
      expect(lottery.ticketNullifier.get()).toEqual(
        state.ticketNullifierMap.getRoot()
      );
      expect(lottery.bankRoot.get()).toEqual(state.bankMap.getRoot());
      expect(lottery.roundResultRoot.get()).toEqual(
        state.roundResultMap.getRoot()
      );
    };
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await lottery.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('one user case', async () => {
    await localDeploy();

    let curRound = 0;

    const balanceBefore = Mina.getBalance(senderAccount);

    // Buy ticket
    const ticket = Ticket.random(senderAccount);
    let [roundWitness, roundTicketWitness, bankWitness, bankValue] =
      state.addTicket(ticket, curRound);
    let tx = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(
        ticket,
        roundWitness,
        roundTicketWitness,
        bankValue,
        bankWitness
      );
    });

    await tx.prove();
    await tx.sign([senderKey]).send();

    const balanceAfter = Mina.getBalance(senderAccount);

    expect(balanceBefore.sub(balanceAfter)).toEqual(TICKET_PRICE);

    checkConsistancy();

    // Wait next round

    // Produce result

    // Get reward
  });

  it('several users test case', async () => {
    await localDeploy();
  });
});
