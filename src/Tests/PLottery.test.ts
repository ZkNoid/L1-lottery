import {
  AccountUpdate,
  Bool,
  Cache,
  Field,
  MerkleMap,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
} from 'o1js';
import { generateNumbersSeed, PLottery } from '../PLottery';
import { Ticket } from '../Structs/Ticket';
import { NumberPacked, convertToUInt64 } from '../util';
import {
  BLOCK_PER_ROUND,
  TICKET_PRICE,
  ZkOnCoordinatorAddress,
  treasury,
} from '../constants';
// import { DistributionProgram } from '../Proofs/DistributionProof';
import { dummyBase64Proof } from 'o1js/dist/node/lib/proof-system/zkprogram';
import { Pickles } from 'o1js/dist/node/snarky';
import { PStateManager } from '../StateManager/PStateManager';
import { TicketReduceProgram } from '../Proofs/TicketReduceProof';
import { CommitValue } from '../Random/RandomManager';
import { MockedRandomManager } from './MockedContracts/MockedRandomManager';
import { FactoryManager } from '../StateManager/FactoryStateManager';
import { MerkleMap20 } from '../Structs/CustomMerkleMap';
import { MockedPlotteryFactory } from './MockedContracts/MockedFactory';

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

const testCommitValue = {
  v1: new CommitValue({
    value: Field(123),
    salt: Field(456),
  }),
  v2: new CommitValue({
    value: Field(654),
    salt: Field(117),
  }),
};

const testVRFValue = Field(789);

const testWinningCombination = generateNumbersSeed(
  Poseidon.hash([testCommitValue.v1.value, testCommitValue.v2.value])
);

const ROUNDS = 10;

let proofsEnabled = false;

describe('Add', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    restAccs: Mina.TestPublicKey[],
    users: Mina.TestPublicKey[],
    senderKey: PrivateKey,
    factoryPrivateKey: PrivateKey,
    factoryAddress: PublicKey,
    factory: MockedPlotteryFactory,
    factoryManager: FactoryManager,
    plotteries: { [round: number]: PLottery },
    randomManagers: { [round: number]: MockedRandomManager },
    checkConsistency: () => void,
    mineNBlocks: (n: number) => void,
    commitValue: (round: number) => Promise<void>,
    produceResultInRM: (round: number) => Promise<void>,
    deployRound: (round: number) => Promise<{
      plotteryContract: PLottery;
      randomManagerContract: MockedRandomManager;
    }>,
    getWinningCombinationPacked: (n: number) => Field;
  beforeAll(async () => {
    if (proofsEnabled) {
      // console.log(`Compiling distribution program proof`);
      // await DistributionProgram.compile({
      //   cache: Cache.FileSystem('./cache'),
      // });
      console.log(`Compiling reduce program proof`);
      await TicketReduceProgram.compile({
        cache: Cache.FileSystem('./cache'),
      });
      console.log(`Compiling MockLottery`);
      throw Error('Currently there is no option to compile PLottery');
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
    factoryPrivateKey = PrivateKey.random();
    factoryAddress = factoryPrivateKey.toPublicKey();

    factory = new MockedPlotteryFactory(factoryAddress);
    plotteries = {};
    randomManagers = {};

    // rmStateManager = new RandomManagerManager();
    factoryManager = new FactoryManager(true, true);
    mineNBlocks = (n: number) => {
      let curAmount = Local.getNetworkState().globalSlotSinceGenesis;
      Local.setGlobalSlot(curAmount.add(n));
    };
    checkConsistency = () => {
      // expect(lottery.ticketRoot.get()).toEqual(state.ticketMap.getRoot());
      // expect(lottery.ticketNullifier.get()).toEqual(
      //   state.ticketNullifierMap.getRoot()
      // );
      // expect(lottery.bankRoot.get()).toEqual(state.bankMap.getRoot());
      // expect(lottery.roundResultRoot.get()).toEqual(
      //   state.roundResultMap.getRoot()
      // );
    };
    commitValue = async (round: number) => {
      let randomManager = randomManagers[round];
      let rmStateManager = factoryManager.randomManagers[round];
      let tx = await Mina.transaction(deployerAccount, async () => {
        await randomManager.firstPartyCommit(testCommitValue.v1);
      });
      await tx.prove();
      await tx.sign([deployerKey]).send();

      let tx2 = await Mina.transaction(deployerAccount, async () => {
        await randomManager.secondPartyCommit(testCommitValue.v2);
      });
      await tx2.prove();
      await tx2.sign([deployerKey]).send();
      // rmStateManager.addCommit(testCommitValue);
    };
    produceResultInRM = async (round: number) => {
      let randomManager = randomManagers[round];

      let tx2 = await Mina.transaction(deployerAccount, async () => {
        await randomManager.revealFirstCommit(testCommitValue.v1);
      });
      await tx2.prove();
      await tx2.sign([deployerKey]).send();

      let tx3 = await Mina.transaction(deployerAccount, async () => {
        await randomManager.revealSecondCommit(testCommitValue.v2);
      });
      await tx3.prove();
      await tx3.sign([deployerKey]).send();
    };

    deployRound = async (round: number) => {
      const roundWitness = factoryManager.roundsMap.getWitness(Field(round));
      const randomManagerKeypair = PrivateKey.randomKeypair();
      const plotteryKeypair = PrivateKey.randomKeypair();

      const tx = await Mina.transaction(deployerAccount, async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        AccountUpdate.fundNewAccount(deployerAccount);
        await factory.deployRound(
          roundWitness,
          randomManagerKeypair.publicKey,
          plotteryKeypair.publicKey
        );
      });
      await tx.prove();
      await tx
        .sign([
          deployerKey,
          randomManagerKeypair.privateKey,
          plotteryKeypair.privateKey,
        ])
        .send();

      factoryManager.addDeploy(
        round,
        randomManagerKeypair.publicKey,
        plotteryKeypair.publicKey
      );

      const plotteryContract = new PLottery(plotteryKeypair.publicKey);
      const randomManagerContract = new MockedRandomManager(
        randomManagerKeypair.publicKey
      );

      return {
        plotteryContract,
        randomManagerContract,
      };
    };

    getWinningCombinationPacked = (round: number) => {
      const rmResult = randomManagers[round].result.get();
      const winningNumbers = generateNumbersSeed(rmResult);
      const winningNumbersPacked = NumberPacked.pack(winningNumbers);

      return winningNumbersPacked;
    };
  });
  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await factory.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, factoryPrivateKey]).send();

    for (let i = 0; i < ROUNDS; i++) {
      const { plotteryContract, randomManagerContract } = await deployRound(i);
      plotteries[i] = plotteryContract;
      randomManagers[i] = randomManagerContract;
    }
  }

  it('check plottery initial values', async () => {
    await localDeploy();

    for (let i = 0; i < ROUNDS; i++) {
      let plottery = plotteries[i];

      expect(plottery.randomManager.get()).toEqual(randomManagers[i].address);
      expect(plottery.startSlot.get()).toEqual(
        UInt32.from(BLOCK_PER_ROUND * i)
      );
      expect(plottery.ticketRoot.get()).toEqual(new MerkleMap20().getRoot());
      expect(plottery.ticketNullifier.get()).toEqual(
        new MerkleMap20().getRoot()
      );
      expect(plottery.bank.get()).toEqual(Field(0));
      expect(plottery.result.get()).toEqual(Field(0));
      expect(plottery.totalScore.get()).toEqual(UInt64.from(0));
    }
  });

  it('one user case', async () => {
    await localDeploy();
    let curRound = 0;
    const balanceBefore = Mina.getBalance(senderAccount);
    // Buy ticket
    const ticket = Ticket.from(testWinningCombination, senderAccount, 1);

    let state = factoryManager.plotteryManagers[curRound];
    let lottery = plotteries[curRound];
    console.log('Buying ticket');
    let tx = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(ticket);
    });
    await tx.prove();
    await tx.sign([senderKey]).send();
    const balanceAfter = Mina.getBalance(senderAccount);
    expect(balanceBefore.sub(balanceAfter)).toEqual(TICKET_PRICE);
    checkConsistency();

    console.log('Commiting value');
    // Wait next round
    mineNBlocks(BLOCK_PER_ROUND);
    // Commit value for random
    await commitValue(curRound);

    console.log('Revealing');
    await produceResultInRM(curRound);
    // Produce result

    console.log('Produced in RM');

    let winningNumbers = getWinningCombinationPacked(curRound);
    console.log(`Before reduce`);
    let reduceProof = await state.reduceTickets(winningNumbers);
    console.log(`Here`);
    let tx2 = await Mina.transaction(senderAccount, async () => {
      await lottery.reduceTicketsAndProduceResult(reduceProof);
    });
    await tx2.prove();
    await tx2.sign([senderKey]).send();
    checkConsistency();

    // Get reward
    const rp = await state.getReward(curRound, ticket);

    // Try to get reward with wrong account
    // await expect(
    //   Mina.transaction(restAccs[0], async () => {
    //     await lottery.getReward(ticket, rp.ticketWitness, rp.nullifierWitness);
    //   })
    // ).rejects.toThrow('Field.assertEquals()');

    let faultTicket = Ticket.fromFields(Ticket.toFields(ticket)) as Ticket;
    faultTicket.owner = restAccs[0];
    await expect(
      Mina.transaction(restAccs[0], async () => {
        await lottery.getReward(
          faultTicket,
          rp.ticketWitness,
          rp.nullifierWitness
        );
      })
    ).rejects.toThrow('Field.assertEquals()');

    // Valid transaction

    let tx3 = await Mina.transaction(senderAccount, async () => {
      await lottery.getReward(ticket, rp.ticketWitness, rp.nullifierWitness);
    });
    await tx3.prove();
    await tx3.sign([senderKey]).send();
    checkConsistency();
  });

  it('Refund check', async () => {
    await localDeploy();
    let curRound = 0;
    let lottery = plotteries[curRound];
    let state = factoryManager.plotteryManagers[curRound];
    const balanceBefore = Mina.getBalance(senderAccount);
    // Buy ticket
    const ticket = Ticket.from(testWinningCombination, senderAccount, 1);
    let tx = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(ticket);
    });
    await tx.prove();
    await tx.sign([senderKey]).send();
    const balanceAfter = Mina.getBalance(senderAccount);
    expect(balanceBefore.sub(balanceAfter)).toEqual(TICKET_PRICE);
    checkConsistency();
    // Buy second ticket
    let tx1_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.buyTicket(ticket);
    });
    await tx1_1.prove();
    await tx1_1.sign([senderKey]).send();
    // Wait 3 more rounds
    mineNBlocks(3 * BLOCK_PER_ROUND + 1);
    // Commit value for random
    await commitValue(curRound);
    // Reduce tickets
    // let winningNumbers = getWinningCombinationPacked(curRound);
    let reduceProof = await state.reduceTickets(Field(0));
    let tx2_1 = await Mina.transaction(senderAccount, async () => {
      await lottery.emergencyReduceTickets(reduceProof);
    });
    await tx2_1.prove();
    await tx2_1.sign([senderKey]).send();

    checkConsistency();
    // Get refund

    console.log(`Before: ${lottery.ticketRoot.get().toString()}`);
    console.log(state.ticketMap.getRoot().toString());

    let { ticketWitness } = await state.getRefund(0, ticket);
    const balanceBefore2 = Mina.getBalance(senderAccount);
    let tx3 = await Mina.transaction(senderAccount, async () => {
      await lottery.refund(ticket, ticketWitness);
    });
    await tx3.prove();
    await tx3.sign([senderKey]).send();
    checkConsistency();
    const balanceAfter2 = Mina.getBalance(senderAccount);
    expect(balanceAfter2.sub(balanceBefore2)).toEqual(TICKET_PRICE);
    // Produce random value
    await produceResultInRM(curRound);

    console.log(`After: ${lottery.ticketRoot.get().toString()}`);
    console.log(state.ticketMap.getRoot().toString());

    // Produce result
    state.ticketMap = new MerkleMap20();
    state.lastTicketInRound = 0;
    let winningNumbers = getWinningCombinationPacked(curRound);
    reduceProof = await state.reduceTickets(winningNumbers);
    let tx4 = await Mina.transaction(senderAccount, async () => {
      await lottery.reduceTicketsAndProduceResult(reduceProof);
    });
    await tx4.prove();
    await tx4.sign([senderKey]).send();
    checkConsistency();
    const balanceBefore3 = Mina.getBalance(senderAccount);
    // Get reward for second transaction
    const rp = await state.getReward(curRound, ticket);
    let tx5 = await Mina.transaction(senderAccount, async () => {
      await lottery.getReward(ticket, rp.ticketWitness, rp.nullifierWitness);
    });
    await tx5.prove();
    await tx5.sign([senderKey]).send();
    checkConsistency();
    const balanceAfter3 = Mina.getBalance(senderAccount);
    console.log(`Bank: ${lottery.bank.get().toString()}`);
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
      let lottery = plotteries[round];
      let state = factoryManager.plotteryManagers[round];

      console.log(`Process: ${round} round`);
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
          await lottery.buyTicket(ticket.ticket);
        });
        await tx.prove();
        await tx.sign([ticket.owner.key]).send();
        const balanceAfter = Mina.getBalance(ticket.owner);
        expect(balanceBefore.sub(balanceAfter)).toEqual(TICKET_PRICE);
        checkConsistency();
      }
      // Wait for the end of round
      mineNBlocks(BLOCK_PER_ROUND);
      // Commit value for random
      await commitValue(round);
      // Produce random value
      await produceResultInRM(round);

      // Produce result
      let winningNumbers = getWinningCombinationPacked(round);
      let reduceProof = await state.reduceTickets(winningNumbers);
      let tx2 = await Mina.transaction(senderAccount, async () => {
        await lottery.reduceTicketsAndProduceResult(reduceProof);
      });
      await tx2.prove();
      await tx2.sign([senderKey]).send();
      checkConsistency();
      const bank = convertToUInt64(lottery.bank.get());
      // Get rewards
      for (let j = 0; j < amountOfTickets; j++) {
        const ticketInfo = tickets[j];
        const balanceBefore = Mina.getBalance(ticketInfo.owner);
        const ticket = ticketInfo.ticket;
        const score = ticket.getScore(
          testWinningCombination.map((val) => UInt32.from(val))
        );
        const rp = await state.getReward(round, ticket);
        let tx3 = await Mina.transaction(ticketInfo.owner, async () => {
          await lottery.getReward(
            ticket,
            rp.ticketWitness,
            rp.nullifierWitness
          );
        });
        await tx3.prove();
        await tx3.sign([ticketInfo.owner.key]).send();
        checkConsistency();

        const balanceAfter = Mina.getBalance(ticketInfo.owner);
        const totalScore = await lottery.totalScore.get();

        expect(balanceAfter.sub(balanceBefore)).toEqual(
          bank.mul(score).div(totalScore)
        );
      }
    }
  });
});