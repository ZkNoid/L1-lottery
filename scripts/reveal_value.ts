import { Field, Mina, Poseidon } from 'o1js';
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

const { witness: commitRoundWitness } = rmStoreManager.getCommitWitness(+round);
const { witness: resultRoundWitness } = rmStoreManager.getResultWitness(+round);
const commitValue = rmStoreManager.commits[+round];
const vrfValue = randomManager.curRandomValue.get();

let tx = await Mina.transaction(deployer, async () => {
  await randomManager.reveal(
    commitValue,
    commitRoundWitness,
    resultRoundWitness
  );
});

await tx.prove();
await tx.sign([deployerKey]).send();

rmStoreManager.addResultValue(
  +round,
  Poseidon.hash([commitValue.value, vrfValue])
);

storeRMStoreManager(rmStoreManager, deploy_epoch);
