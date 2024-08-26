import { Field, Mina } from 'o1js';
import { RandomManagerManager } from '../src/StateManager/RandomManagerManager';
import {
  compileRandomManager,
  configDefaultInstance,
  findPlottery,
  findRandomManager,
  getDeployer,
  getRMStoreManager,
  storeRMStoreManager,
} from './utils';
import { CommitValue } from '../src/Random/RandomManager';

configDefaultInstance();

let round = process.argv[2];

if (!round) {
  throw Error(`You should specify round`);
}

let deploy_epoch = process.argv[3] ? process.argv[3] : 'current';

let { deployer, deployerKey } = getDeployer();

let { randomManager } = findRandomManager(deploy_epoch);

await compileRandomManager(deploy_epoch);

let rmStoreManager: RandomManagerManager = getRMStoreManager(deploy_epoch);

let value = Field.random();
let salt = Field.random();
let commitValue = new CommitValue({ value, salt });

const { witness: commitRoundWitness } = rmStoreManager.getCommitWitness(+round);

let tx = await Mina.transaction(deployer, async () => {
  await randomManager.commit(commitValue, commitRoundWitness);
});

await tx.prove();
await tx.sign([deployerKey]).send();

rmStoreManager.addCommit(+round, commitValue);

storeRMStoreManager(rmStoreManager, deploy_epoch);
