import {
  AccountUpdate,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
} from 'o1js';
import { BLOCK_PER_ROUND, treasury } from '../constants';
import { CommitValue } from '../Random/RandomManager';
import { FactoryManager } from '../StateManager/FactoryStateManager';
import { MockedRandomManager } from './MockedContracts/MockedRandomManager';
import { MockedPlotteryFactory } from './MockedContracts/MockedFactory';

const testCommitValues = [...Array(10)].map((_, i) => {
  return {
    v1: new CommitValue({ value: Field(i + 1), salt: Field.random() }),
    v2: new CommitValue({ value: Field(2 * i + 1), salt: Field.random() }),
  };
});

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
    factory: MockedPlotteryFactory,
    randomManager: MockedRandomManager,
    factoryManager: FactoryManager,
    mineNBlocks: (n: number) => void,
    commitValue: (
      round: number,
      commitValue1: CommitValue,
      commitValue2: CommitValue
    ) => Promise<void>,
    produceResultInRM: (
      round: number,
      commitValue1: CommitValue,
      commitValue2: CommitValue
    ) => Promise<void>;

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
    commitValue = async (
      round: number,
      commitValue1: CommitValue,
      commitValue2: CommitValue
    ) => {
      let tx = Mina.transaction(deployerAccount, async () => {
        randomManager.firstPartyCommit(commitValue1);
      });
      await tx.prove();
      await tx.sign([deployerKey]).send();

      let tx2 = Mina.transaction(deployerAccount, async () => {
        randomManager.secondPartyCommit(commitValue2);
      });
      await tx2.prove();
      await tx2.sign([deployerKey]).send();

      // factoryManager.randomManagers[round].addCommit(commitValue);
    };
    produceResultInRM = async (
      round: number,
      commitValue1: CommitValue,
      commitValue2: CommitValue
    ) => {
      let tx2 = Mina.transaction(deployerAccount, async () => {
        randomManager.revealFirstCommit(commitValue1);
      });
      await tx2.prove();
      await tx2.sign([deployerKey]).send();

      let tx3 = Mina.transaction(deployerAccount, async () => {
        randomManager.revealSecondCommit(commitValue2);
      });
      await tx3.prove();
      await tx3.sign([deployerKey]).send();
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

    // expect(randomManager.startSlot.get()).toEqual(UInt32.from(0));
    // expect(randomManager.commit.get()).toEqual(Field(0));
    // expect(randomManager.result.get()).toEqual(Field(0));
    // expect(randomManager.curRandomValue.get()).toEqual(Field(0));
  });

  it('Should produce random value', async () => {
    await localDeploy();

    let i = 0;
    await commitValue(i, testCommitValues[i].v1, testCommitValues[i].v2);

    mineNBlocks(BLOCK_PER_ROUND + 1);

    await produceResultInRM(i, testCommitValues[i].v1, testCommitValues[i].v2);

    const seed = Poseidon.hash([
      testCommitValues[i].v1.value,
      testCommitValues[i].v2.value,
    ]);
    expect(randomManager.result.get()).toEqual(seed);
  });
});
