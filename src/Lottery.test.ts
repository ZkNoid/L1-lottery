import {
  AccountUpdate,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Mina,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
} from 'o1js';
import { MockLottery, NumberPacked, mockWinningCombination } from './Lottery';
import { Ticket } from './Ticket';
import { getEmpty2dMerkleMap } from './util';
import { BLOCK_PER_ROUND, TICKET_PRICE } from './constants';
import {
  DistibutionProgram,
  DistributionProof,
  DistributionProofPublicInput,
  addTicket,
  init,
} from './DistributionProof';
import { dummyBase64Proof } from 'o1js/dist/node/lib/proof-system/zkprogram';
import { Pickles } from 'o1js/dist/node/snarky';

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
  const [, proof] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
  return new ProofType({
    proof: proof,
    maxProofsVerified: 2,
    publicInput,
    publicOutput,
  });
}

class StateManager {
  ticketMap: MerkleMap;
  roundTicketMap: MerkleMap[];
  roundTickets: Ticket[][];
  lastTicketInRound: number[];
  ticketNullifierMap: MerkleMap;
  bankMap: MerkleMap;
  roundResultMap: MerkleMap;
  startBlock: Field;

  constructor() {
    this.ticketMap = getEmpty2dMerkleMap();
    this.roundTicketMap = [new MerkleMap()];
    this.lastTicketInRound = [0];
    this.roundTickets = [[]];
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
    this.roundTickets[round].push(ticket);
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

  updateResult(round: number): MerkleMapWitness {
    const witness = this.roundResultMap.getWitness(Field.from(round));
    const packedNumbers = NumberPacked.pack(
      mockWinningCombination.map((val) => UInt32.from(val))
    );
    this.roundResultMap.set(Field.from(round), packedNumbers);

    return witness;
  }

  async getDP(round: number): Promise<DistributionProof> {
    const winningCombination = this.roundResultMap.get(Field.from(round));
    let ticketsInRound = this.lastTicketInRound[round];
    let curMap = new MerkleMap();

    let input = new DistributionProofPublicInput({
      winningCombination,
      ticket: Ticket.random(PublicKey.empty()),
      valueWitness: this.roundTicketMap[round].getWitness(Field(0)),
    });

    let curProof = await mockProof(await init(input), DistributionProof, input);

    for (let i = 0; i < ticketsInRound; i++) {
      const ticket = this.roundTickets[round][i];

      const input = new DistributionProofPublicInput({
        winningCombination,
        ticket: ticket,
        valueWitness: curMap.getWitness(Field(i)),
      });
      curMap.set(Field(i), ticket.hash());
      curProof = await mockProof(
        await addTicket(input, curProof),
        DistributionProof,
        input
      );
      // curProof = await DistibutionProgram.addTicket(input, curProof);
    }

    return curProof;
  }

  // Changes value of nullifier!
  async getReward(
    round: number,
    ticket: Ticket
  ): Promise<{
    roundWitness: MerkleMapWitness;
    roundTicketWitness: MerkleMapWitness;
    dp: DistributionProof;
    winningNumbers: Field;
    resultWitness: MerkleMapWitness;
    bankValue: Field;
    bankWitness: MerkleMapWitness;
    nullifierWitness: MerkleMapWitness;
  }> {
    const roundWitness = this.ticketMap.getWitness(Field.from(round));

    const ticketHash = ticket.hash();
    let roundTicketWitness;
    // Find ticket in tree
    for (let i = 0; i < this.lastTicketInRound[round]; i++) {
      if (
        this.roundTicketMap[round].get(Field(i)).equals(ticketHash).toBoolean()
      ) {
        roundTicketWitness = this.roundTicketMap[round].getWitness(
          Field.from(i)
        );
        break;
      }
    }
    if (!roundTicketWitness) {
      throw Error(`No such ticket in round ${round}`);
    }

    const dp = await this.getDP(round);
    const winningNumbers = this.roundResultMap.get(Field.from(round));
    if (winningNumbers.equals(Field(0)).toBoolean()) {
      throw Error('Do not have a result for this round');
    }
    const resultWitness = this.roundResultMap.getWitness(Field.from(round));

    const bankValue = this.bankMap.get(Field.from(round));
    const bankWitness = this.bankMap.getWitness(Field.from(round));

    const nullifierWitness = this.ticketNullifierMap.getWitness(
      ticket.nullifierHash(Field.from(round))
    );

    this.ticketNullifierMap.set(
      ticket.nullifierHash(Field.from(round)),
      Field(1)
    );

    return {
      roundWitness,
      roundTicketWitness,
      dp,
      winningNumbers,
      resultWitness,
      bankValue,
      bankWitness,
      nullifierWitness,
    };
  }
}

let proofsEnabled = false;

describe('Add', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    restAccs: Mina.TestPublicKey[],
    users: Mina.TestPublicKey[],
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    lottery: MockLottery,
    state: StateManager,
    checkConsistancy: () => void,
    mineNBlocks: (n: number) => void;

  beforeAll(async () => {
    if (proofsEnabled) await MockLottery.compile();
  });

  beforeEach(async () => {
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    [deployerAccount, senderAccount, ...restAccs] = Local.testAccounts;
    users = restAccs.slice(0, 7);
    deployerKey = deployerAccount.key;
    senderKey = senderAccount.key;

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    lottery = new MockLottery(zkAppAddress);
    state = new StateManager();

    mineNBlocks = (n: number) => {
      let curAmount = Local.getNetworkState().blockchainLength;
      Local.setBlockchainLength(curAmount.add(n));
    };

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

  xit('one user case', async () => {
    await localDeploy();

    let curRound = 0;

    const balanceBefore = Mina.getBalance(senderAccount);

    // Buy ticket
    const ticket = Ticket.from(mockWinningCombination, senderAccount, 1);
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
    mineNBlocks(BLOCK_PER_ROUND);

    // Produce result
    const resultWitness = state.updateResult(curRound);
    let tx2 = await Mina.transaction(senderAccount, async () => {
      await lottery.produceResult(resultWitness);
    });

    await tx2.prove();
    await tx2.sign([senderKey]).send();
    checkConsistancy();

    // Get reward
    const rp = await state.getReward(curRound, ticket);
    let tx3 = await Mina.transaction(senderAccount, async () => {
      await lottery.getReward(
        ticket,
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

    await tx3.prove();
    await tx3.sign([senderKey]).send();
    checkConsistancy();
  });

  it('several users test case', async () => {
    await localDeploy();

    /*
      There will be 7 users, that guesed 0,1,2,3,4,5,6 numbers 
    */

    let curRound = 0;

    // Buy tickets
    for (let i = 0; i < users.length; i++) {
      console.log(`Buy ticket for user ${i}`);
      const user = users[i];
      const balanceBefore = Mina.getBalance(user);
      const ticketCombination = [...Array(6)].map((val, index) =>
        index < i ? 1 : 2
      );
      const ticket = Ticket.from(ticketCombination, user, 1);
      let [roundWitness, roundTicketWitness, bankWitness, bankValue] =
        state.addTicket(ticket, curRound);
      let tx = await Mina.transaction(user, async () => {
        await lottery.buyTicket(
          ticket,
          roundWitness,
          roundTicketWitness,
          bankValue,
          bankWitness
        );
      });

      await tx.prove();
      await tx.sign([user.key]).send();

      const balanceAfter = Mina.getBalance(user);

      expect(balanceBefore.sub(balanceAfter)).toEqual(TICKET_PRICE);

      checkConsistancy();
    }

    // Wait next round
    mineNBlocks(BLOCK_PER_ROUND);

    // Produce result
    console.log(`Produce result`);
    const resultWitness = state.updateResult(curRound);
    let tx2 = await Mina.transaction(senderAccount, async () => {
      await lottery.produceResult(resultWitness);
    });

    await tx2.prove();
    await tx2.sign([senderKey]).send();
    checkConsistancy();

    const bank = UInt64.fromFields([state.bankMap.get(Field.from(curRound))]);
    const winningCombination = mockWinningCombination.map((num) =>
      UInt32.from(num)
    );

    // Get reward
    for (let i = 0; i < users.length; i++) {
      console.log(`Get reward for user ${i}`);
      const user = users[i];
      const balanceBefore = Mina.getBalance(user);

      const ticketCombination = [...Array(6)].map((val, index) =>
        index < i ? 1 : 2
      );
      const ticket = Ticket.from(ticketCombination, user, 1);
      const score = UInt64.fromFields([ticket.getScore(winningCombination)]);

      const rp = await state.getReward(curRound, ticket);
      let tx3 = await Mina.transaction(user, async () => {
        await lottery.getReward(
          ticket,
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

      await tx3.prove();
      await tx3.sign([user.key]).send();
      checkConsistancy();

      const balanceAfter = Mina.getBalance(user);

      expect(balanceAfter.sub(balanceBefore)).toEqual(
        bank.mul(score).div(UInt64.fromFields([rp.dp.publicOutput.total]))
      );
    }
  });
});
