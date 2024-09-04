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
import { PLotteryType, generateNumbersSeed, getPLottery } from '../PLottery';
import { Ticket } from '../Structs/Ticket';
import { NumberPacked, convertToUInt64 } from '../util';
import {
  BLOCK_PER_ROUND,
  TICKET_PRICE,
  ZkOnCoordinatorAddress,
  treasury,
} from '../constants';
import { DistibutionProgram } from '../Proofs/DistributionProof';
import { dummyBase64Proof } from 'o1js/dist/node/lib/proof-system/zkprogram';
import { Pickles } from 'o1js/dist/node/snarky';
import { PStateManager } from '../StateManager/PStateManager';
import { TicketReduceProgram } from '../Proofs/TicketReduceProof';
import {
  CommitValue,
  MockedRandomManagerType,
  RandomManagerType,
  getMockedRandomManager,
  getRandomManager,
} from '../Random/RandomManager';
import { RandomManagerManager } from '../StateManager/RandomManagerManager';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';

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
    randomManager: MockedRandomManagerType,
    rmStateManager: RandomManagerManager,
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
    let RandomManager = getMockedRandomManager(deployerAccount);
    randomManager = new RandomManager(randomManagerAddress);

    rmStateManager = new RandomManagerManager();
    // rmStateManager = new RandomManagerManager();
    mineNBlocks = (n: number) => {
      let curAmount = Local.getNetworkState().globalSlotSinceGenesis;
      Local.setGlobalSlot(curAmount.add(n));
    };

    commitValue = async (round: number, commitValue: CommitValue) => {
      const commitWV = rmStateManager.getCommitWitness(round);
      let tx = Mina.transaction(deployerAccount, async () => {
        randomManager.commit(commitValue, commitWV.witness);
      });
      await tx.prove();
      await tx.sign([deployerKey]).send();
      rmStateManager.addCommit(round, commitValue);
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
      const commitWV = rmStateManager.getCommitWitness(round);
      const resultWV = rmStateManager.getResultWitness(round);
      let tx2 = Mina.transaction(deployerAccount, async () => {
        randomManager.reveal(commitValue, commitWV.witness, resultWV.witness);
      });
      await tx2.prove();
      await tx2.sign([deployerKey]).send();
      rmStateManager.addResultValue(
        round,
        Poseidon.hash([commitValue.value, vrfValue])
      );
    };
  });
  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await randomManager.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, randomManagerPrivateKey]).send();
  }

  it('Sould produce random value', async () => {
    await localDeploy();

    expect(rmStateManager.commitMap.getRoot()).toEqual(
      randomManager.commitRoot.get()
    );

    expect(rmStateManager.resultMap.getRoot()).toEqual(
      randomManager.resultRoot.get()
    );

    for (let i = 0; i < 10; i++) {
      console.log(i);
      await commitValue(i, testCommitValues[i]);

      expect(rmStateManager.commitMap.getRoot()).toEqual(
        randomManager.commitRoot.get()
      );

      mineNBlocks(BLOCK_PER_ROUND + 1);

      await produceResultInRM(i, testVRFValues[i], testCommitValues[i]);

      const seed = Poseidon.hash([testCommitValues[i].value, testVRFValues[i]]);
      expect(rmStateManager.resultMap.get(Field(i))).toEqual(seed);
      expect(rmStateManager.resultMap.getRoot()).toEqual(
        randomManager.resultRoot.get()
      );
    }
  });

  it('JSON works', async () => {
    for (let i = 0; i < testCommitValues.length; i++) {
      rmStateManager.addCommit(i, testCommitValues[i]);
      rmStateManager.addResultValue(i, testVRFValues[i]);
    }

    let json = rmStateManager.toJSON();

    let copy = RandomManagerManager.fromJSON(json);

    expect(rmStateManager.commitMap.getRoot()).toEqual(
      copy.commitMap.getRoot()
    );

    expect(rmStateManager.resultMap.getRoot()).toEqual(
      copy.resultMap.getRoot()
    );

    for (let i = 0; i < testCommitValues.length; i++) {
      expect(rmStateManager.commits[i].hash()).toEqual(copy.commits[i].hash());
      expect(rmStateManager.results[i]).toEqual(copy.results[i]);
    }
  });
});
