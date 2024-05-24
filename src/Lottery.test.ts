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
    state: StateManager;

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

    // Buy ticket
    const ticket = Ticket.random(senderAccount);
    let [roundWitness, roundTicketWitness] =
      state.getNextTicketWitenss(curRound);
    let [bankWitness, bankValue] = state.getBankWitness(curRound);
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

    // Wait next round

    // Produce result

    // Get reward
  });

  it('several users test case', async () => {
    await localDeploy();
  });
});
