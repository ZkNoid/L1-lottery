import {
  AccountUpdate,
  Cache,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  Struct,
  UInt32,
  UInt64,
} from 'o1js';
import { Ticket } from '../Structs/Ticket';
import { NumberPacked, convertToUInt64 } from '../util';
import {
  BLOCK_PER_ROUND,
  TICKET_PRICE,
  ZkOnCoordinatorAddress,
  treasury,
} from '../constants';
import { RandomManagerManager } from '../StateManager/RandomManagerManager';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
import { CommitValue, RandomManager } from '../Random/RandomManager';
import { PlotteryFactory } from '../Factory';
import { FactoryManager } from '../StateManager/FactoryStateManager';
import { PLottery } from '../PLottery';
import { TicketReduceProgram } from '../Proofs/TicketReduceProof';
import { DistributionProgram } from '../Proofs/DistributionProof';
import { MockedRandomManager } from './MockedContracts/MockedRandomManager';
import { MockedPlotteryFactory } from './MockedContracts/MockedFactory';

const testCommitValues = [...Array(10)].map(
  (_, i) => new CommitValue({ value: Field(i), salt: Field.random() })
);

const testVRFValues = [...Array(10)].map((_, i) =>
  Field(Poseidon.hash([Field(i)]))
);

let proofsEnabled = false;

describe('Add', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    restAccs: Mina.TestPublicKey[],
    users: Mina.TestPublicKey[],
    senderKey: PrivateKey,
    randomManagerAddress: PublicKey,
    randomManagerPrivateKey: PrivateKey,
    factoryAddress: PublicKey,
    factoryPrivateKey: PrivateKey,
    factory: PlotteryFactory,
    randomManager: MockedRandomManager,
    factoryManager: FactoryManager,
    mineNBlocks: (n: number) => void,
    commitValue: (round: number, commitValue: CommitValue) => Promise<void>,
    produceResultInRM: (
      round: number,
      vrfValue: Field,
      commitValue: CommitValue
    ) => Promise<void>;
  beforeAll(async () => {
    if (proofsEnabled) {
      await ZkonZkProgram.compile({});
      await ZkonRequestCoordinator.compile({});
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
    randomManagerPrivateKey = PrivateKey.random();
    randomManagerAddress = randomManagerPrivateKey.toPublicKey();
    factoryPrivateKey = PrivateKey.random();
    factoryAddress = factoryPrivateKey.toPublicKey();
    randomManager = new MockedRandomManager(randomManagerAddress);
    // randomManager = new RandomManager(randomManagerAddress);
    // factory = new MockedPlotteryFactory(factoryAddress);
    factory = new MockedPlotteryFactory(factoryAddress);

    factoryManager = new FactoryManager();
    mineNBlocks = (n: number) => {
      let curAmount = Local.getNetworkState().globalSlotSinceGenesis;
      Local.setGlobalSlot(curAmount.add(n));
    };
    commitValue = async (round: number, commitValue: CommitValue) => {
      let tx = Mina.transaction(deployerAccount, async () => {
        randomManager.commitValue(commitValue);
      });
      await tx.prove();
      await tx.sign([deployerKey]).send();
      factoryManager.randomManagers[round].addCommit(commitValue);
    };
    produceResultInRM = async (
      round: number,
      vrfValue: Field,
      commitValue: CommitValue
    ) => {
      let tx = Mina.transaction(deployerAccount, async () => {
        randomManager.mockReceiveZkonResponse(vrfValue);
      });
      await tx.prove();
      await tx.sign([deployerKey]).send();
      let tx2 = Mina.transaction(deployerAccount, async () => {
        randomManager.reveal(commitValue);
      });
      await tx2.prove();
      await tx2.sign([deployerKey]).send();
    };
  });
  async function localDeploy() {
    // // Factory deploy
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await factory.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, factoryPrivateKey]).send();
    let roundWitness = factoryManager.roundsMap.getWitness(Field(0));
    let plotteryKey = PrivateKey.randomKeypair();
    let plotteryAddress = plotteryKey.publicKey; // Do not need it for now
    const tx2 = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      AccountUpdate.fundNewAccount(deployerAccount);
      await factory.deployRound(
        roundWitness,
        randomManagerAddress,
        plotteryAddress // Do not need it for now
      );
    });
    await tx2.prove();
    await tx2
      .sign([deployerKey, plotteryKey.privateKey, randomManagerPrivateKey])
      .send();
    factoryManager.addDeploy(0, randomManagerAddress, plotteryAddress);
  }

  it('Initial state check', async () => {
    await localDeploy();

    expect(factory.roundsRoot.get()).toEqual(
      factoryManager.roundsMap.getRoot()
    );

    expect(randomManager.startSlot.get()).toEqual(UInt32.from(0));
    expect(randomManager.commit.get()).toEqual(Field(0));
    expect(randomManager.result.get()).toEqual(Field(0));
    expect(randomManager.curRandomValue.get()).toEqual(Field(0));
  });

  it('Should produce random value', async () => {
    await localDeploy();

    // for (let i = 0; i < 10; i++) {
    let i = 0;
    // console.log(i);
    await commitValue(i, testCommitValues[i]);

    mineNBlocks(BLOCK_PER_ROUND + 1);

    await produceResultInRM(i, testVRFValues[i], testCommitValues[i]);

    const seed = Poseidon.hash([testCommitValues[i].value, testVRFValues[i]]);
    expect(randomManager.result.get()).toEqual(seed);
    // }
  });

  // it('JSON works', async () => {
  //   rmStateManager.addCommit(testCommitValues[0]);

  //   let json = rmStateManager.toJSON();

  //   let copy = RandomManagerManager.fromJSON(json);

  //   expect(rmStateManager.commit).toEqual(copy.commit);
  // });
});
