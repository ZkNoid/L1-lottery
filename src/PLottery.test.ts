import {
  AccountUpdate,
  Cache,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Mina,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
} from 'o1js';
import { PLottery, mockResult } from './PLottery';
import { Ticket } from './Ticket';
import {
  NumberPacked,
  getEmpty2dMerkleMap,
  getTotalScoreAndCommision,
} from './util';
import {
  BLOCK_PER_ROUND,
  TICKET_PRICE,
  mockWinningCombination,
} from './constants';
import {
  DistibutionProgram,
  DistributionProof,
  DistributionProofPublicInput,
  addTicket,
  init,
} from './DistributionProof';
import { dummyBase64Proof } from 'o1js/dist/node/lib/proof-system/zkprogram';
import { Pickles } from 'o1js/dist/node/snarky';
import { MerkleMap20, MerkleMap20Witness } from './CustomMerkleMap';
import { treasury, treasuryKey } from './private_constants';
import { PStateManager } from './StateManager/PStateManager';
import { TicketReduceProgram } from './TicketReduceProof';

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
    lottery: PLottery,
    state: PStateManager,
    checkConsistancy: () => void,
    mineNBlocks: (n: number) => void;

  beforeAll(async () => {
    if (proofsEnabled) {
      console.log(`Compiling distribution program proof`);
      await DistibutionProgram.compile({ cache: Cache.FileSystem('./cache') });
      console.log(`Compiling reduce program proof`);
      await TicketReduceProgram.compile({ cache: Cache.FileSystem('./cache') });
      console.log(`Compiling MockLottery`);
      await PLottery.compile({ cache: Cache.FileSystem('./cache') });
      console.log(`Successfully compiled`);
    }
  });

  beforeEach(async () => {
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Local.addAccount(treasury, '100');
    Mina.setActiveInstance(Local);
    [deployerAccount, senderAccount, ...restAccs] = Local.testAccounts;
    users = restAccs.slice(0, 7);
    deployerKey = deployerAccount.key;
    senderKey = senderAccount.key;

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    lottery = new PLottery(zkAppAddress);
    state = new PStateManager(
      lottery,
      Local.getNetworkState().blockchainLength.value,
      !proofsEnabled
    );

    mineNBlocks = (n: number) => {
      let curAmount = Local.getNetworkState().globalSlotSinceGenesis;
      Local.setGlobalSlot(curAmount.add(n));
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

  it('one user case', async () => {
    await localDeploy();

    let curRound = 0;

    const balanceBefore = Mina.getBalance(senderAccount);

    // Buy ticket
    const ticket = Ticket.from(mockWinningCombination, senderAccount, 1);

    let tx = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(ticket, Field.from(curRound));
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
      await lottery.produceResult(resultWitness, mockResult);
    });

    await tx2.prove();
    await tx2.sign([senderKey]).send();
    checkConsistancy();

    // Reduce tickets
    let reduceProof = await state.reduceTickets();

    let tx2_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.reduceTickets(reduceProof, Field(1));
    });

    await tx2_1.prove();
    await tx2_1.sign([senderKey]).send();
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

  xit('Multiple round test', async () => {
    await localDeploy();

    const amountOfRounds = 10;
    const amountOfTickets = 10;

    for (let round = 0; round < amountOfRounds; round++) {
      console.log(`Process: ${round} round`);

      // Generate tickets
      let tickets = [];
      for (let j = 0; j < amountOfTickets; j++) {
        let ticket = Ticket.random(users[j % users.length]);
        tickets.push({
          owner: users[j % users.length],
          ticket,
        });
      }

      // For each ticket - buy ticket
      for (let j = 0; j < amountOfTickets; j++) {
        let ticket = tickets[j];

        const balanceBefore = Mina.getBalance(ticket.owner);

        let tx = await Mina.transaction(ticket.owner, async () => {
          await lottery.buyTicket(ticket.ticket, Field.from(round));
        });

        await tx.prove();
        await tx.sign([ticket.owner.key]).send();

        const balanceAfter = Mina.getBalance(ticket.owner);

        expect(balanceBefore.sub(balanceAfter)).toEqual(TICKET_PRICE);

        checkConsistancy();
      }

      const bank = TICKET_PRICE.mul(amountOfTickets);

      // Wait for the end of round
      mineNBlocks(BLOCK_PER_ROUND);

      // Produce result
      const resultWitness = state.updateResult(round);
      let tx2 = await Mina.transaction(senderAccount, async () => {
        await lottery.produceResult(resultWitness, mockResult);
      });

      await tx2.prove();
      await tx2.sign([senderKey]).send();
      checkConsistancy();

      // Reduce tickets
      let reduceProof = await state.reduceTickets();

      let tx2_1 = await Mina.transaction(senderAccount, async () => {
        await lottery.reduceTickets(reduceProof, Field(round + 1));
      });

      await tx2_1.prove();
      await tx2_1.sign([senderKey]).send();
      checkConsistancy();

      // Get rewards
      for (let j = 0; j < amountOfTickets; j++) {
        const ticketInfo = tickets[j];
        const balanceBefore = Mina.getBalance(ticketInfo.owner);

        const ticket = ticketInfo.ticket;
        const score = ticket.getScore(
          mockWinningCombination.map((val) => UInt32.from(val))
        );

        const rp = await state.getReward(round, ticket);
        let tx3 = await Mina.transaction(ticketInfo.owner, async () => {
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
        await tx3.sign([ticketInfo.owner.key]).send();
        checkConsistancy();

        const balanceAfter = Mina.getBalance(ticketInfo.owner);

        expect(balanceAfter.sub(balanceBefore)).toEqual(
          bank
            .mul(score)
            .div(getTotalScoreAndCommision(rp.dp.publicOutput.total))
        );
      }

      // Sync state round
      state.syncWithCurBlock(
        +Mina.activeInstance.getNetworkState().globalSlotSinceGenesis
      );
    }
  });
});
