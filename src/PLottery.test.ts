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
  convertToUInt64,
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
      !proofsEnabled,
      true
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

    // Buy dummy ticket in next round, so reudcer works as expected
    state.syncWithCurBlock(
      +Mina.activeInstance.getNetworkState().globalSlotSinceGenesis
    );
    let dummy_ticket = Ticket.random(senderAccount);
    dummy_ticket.amount = UInt64.zero;
    let tx_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(dummy_ticket, Field.from(curRound + 1));
    });
    await tx_1.prove();
    await tx_1.sign([senderKey]).send();

    // Reduce tickets
    let reduceProof = await state.reduceTickets();

    let tx2_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.reduceTickets(reduceProof);
    });

    await tx2_1.prove();
    await tx2_1.sign([senderKey]).send();
    checkConsistancy();

    // Produce result
    const { resultWitness, bankValue, bankWitness } =
      state.updateResult(curRound);
    let tx2 = await Mina.transaction(senderAccount, async () => {
      await lottery.produceResult(
        resultWitness,
        mockResult,
        bankValue,
        bankWitness
      );
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

  it('Refund check', async () => {
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

    // Buy second ticket
    let tx1_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(ticket, Field.from(curRound));
    });

    await tx1_1.prove();
    await tx1_1.sign([senderKey]).send();

    // Wait 3 more rounds
    mineNBlocks(3 * BLOCK_PER_ROUND + 1);

    // Buy dummy ticket in next round, so reudcer works as expected
    state.syncWithCurBlock(
      +Mina.activeInstance.getNetworkState().globalSlotSinceGenesis
    );

    // Reduce tickets

    // Buy dummy ticket
    let dummy_ticket = Ticket.random(senderAccount);
    dummy_ticket.amount = UInt64.zero;
    let tx_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(dummy_ticket, Field.from(3));
    });
    await tx_1.prove();
    await tx_1.sign([senderKey]).send();

    let reduceProof = await state.reduceTickets();

    let tx2_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.reduceTickets(reduceProof);
    });

    await tx2_1.prove();
    await tx2_1.sign([senderKey]).send();
    checkConsistancy();

    // Get refund

    let {
      roundWitness,
      roundTicketWitness,
      resultWitness: resultWitness1,
      // bankValue,
      // bankWitness,
      nullifierWitness,
    } = await state.getRefund(0, ticket);

    const balanceBefore2 = Mina.getBalance(senderAccount);

    let tx3 = await Mina.transaction(senderAccount, async () => {
      await lottery.refund(
        ticket,
        roundWitness,
        roundTicketWitness,
        resultWitness1,
        // bankValue,
        // bankWitness,
        nullifierWitness
      );
    });

    await tx3.prove();
    await tx3.sign([senderKey]).send();
    checkConsistancy();

    const balanceAfter2 = Mina.getBalance(senderAccount);

    expect(balanceAfter2.sub(balanceBefore2)).toEqual(
      TICKET_PRICE.mul(97).div(100)
    );

    // Produce result
    let { resultWitness, bankValue, bankWitness } =
      state.updateResult(curRound);
    let tx4 = await Mina.transaction(senderAccount, async () => {
      await lottery.produceResult(
        resultWitness,
        mockResult,
        bankValue,
        bankWitness
      );
    });

    await tx4.prove();
    await tx4.sign([senderKey]).send();
    checkConsistancy();

    const balanceBefore3 = Mina.getBalance(senderAccount);

    // Get reward for second transaction
    const rp = await state.getReward(curRound, ticket, undefined, 2);
    let tx5 = await Mina.transaction(senderAccount, async () => {
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

    await tx5.prove();
    await tx5.sign([senderKey]).send();
    checkConsistancy();

    const balanceAfter3 = Mina.getBalance(senderAccount);

    console.log(`Bank: ${state.bankMap.get(Field(0)).toString()}`);
    console.log();

    expect(balanceAfter3.sub(balanceBefore3)).toEqual(
      TICKET_PRICE.mul(97).div(100)
    );
  });

  it('Multiple round test', async () => {
    await localDeploy();

    const amountOfRounds = 5;
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

      // Wait for the end of round
      mineNBlocks(BLOCK_PER_ROUND);

      // Reduce tickets

      // Buy dummy ticket in next round, so reudcer works as expected
      state.syncWithCurBlock(
        +Mina.activeInstance.getNetworkState().globalSlotSinceGenesis
      );
      let dummy_ticket = Ticket.random(senderAccount);
      dummy_ticket.amount = UInt64.zero;
      let tx_1 = await Mina.transaction(senderAccount, async () => {
        await lottery.buyTicket(dummy_ticket, Field.from(round + 1));
      });
      await tx_1.prove();
      await tx_1.sign([senderKey]).send();

      let reduceProof = await state.reduceTickets();

      let tx2_1 = await Mina.transaction(senderAccount, async () => {
        await lottery.reduceTickets(reduceProof);
      });

      await tx2_1.prove();
      await tx2_1.sign([senderKey]).send();
      checkConsistancy();

      // Produce result
      const { resultWitness, bankValue, bankWitness } =
        state.updateResult(round);
      let tx2 = await Mina.transaction(senderAccount, async () => {
        await lottery.produceResult(
          resultWitness,
          mockResult,
          bankValue,
          bankWitness
        );
      });

      await tx2.prove();
      await tx2.sign([senderKey]).send();
      checkConsistancy();

      const bank = convertToUInt64(state.bankMap.get(Field(round)));

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
          bank.mul(score).div(rp.dp.publicOutput.total)
        );
      }

      // Sync state round
      state.syncWithCurBlock(
        +Mina.activeInstance.getNetworkState().globalSlotSinceGenesis
      );
    }
  });
});
