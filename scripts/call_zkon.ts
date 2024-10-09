// import { Field, Mina, Poseidon } from 'o1js';
// import { RandomManagerManager } from '../src/StateManager/RandomManagerManager';
// import {
//   compileRandomManager,
//   configDefaultInstance,
//   findPlottery,
//   findRandomManager,
//   getDeployer,
//   getRMStoreManager,
//   storeRMStoreManager,
// } from './utils';
// import { CommitValue } from '../src/Random/RandomManager';

// configDefaultInstance();

// let deploy_epoch = process.argv[2] ? process.argv[2] : 'current';

// let { deployer, deployerKey } = getDeployer();

// let { randomManager } = findRandomManager(deploy_epoch);

// await compileRandomManager(deploy_epoch);

// let tx = await Mina.transaction(deployer, async () => {
//   await randomManager.callZkon();
// });

// await tx.prove();
// await tx.sign([deployerKey]).send();
