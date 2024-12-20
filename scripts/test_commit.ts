// import {
//   AccountUpdate,
//   fetchAccount,
//   Mina,
//   PrivateKey,
//   Cache,
//   PublicKey,
//   Field,
// } from 'o1js';
// import { configDefaultInstance } from './utils.js';
// import { PlotteryFactory } from '../src/Factory.js';
// import * as fs from 'fs';
// import { CommitValue, RandomManager } from '../src/Random/RandomManager.js';
// import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';

// const { transactionFee } = configDefaultInstance();
// const networkId = Mina.activeInstance.getNetworkId().toString();

// let deployerKey = PrivateKey.fromBase58(process.env.BACKEND_KEY!);
// let deployer = deployerKey.toPublicKey();

// console.log(`Deploying with ${deployer.toBase58()}`);

// console.log(`Compiling Random manager`);
// await ZkonZkProgram.compile({ cache: Cache.FileSystem('cache') });
// await ZkonRequestCoordinator.compile({ cache: Cache.FileSystem('cache') });

// await RandomManager.compile({
//   cache: Cache.FileSystem(`cache`),
// });

// await fetchAccount({
//   publicKey: 'B62qqdpeonJcfVJADCNJ83vzws1n8fSZ5An23xqLU4z2pZ8UgGAc7WV',
// });

// const rmAddress = PublicKey.fromBase58(
//   'B62qqdpeonJcfVJADCNJ83vzws1n8fSZ5An23xqLU4z2pZ8UgGAc7WV'
// );

// let rm = new RandomManager(rmAddress);

// let commit = new CommitValue({
//   value: Field(1),
//   salt: Field(2),
// });

// console.log(`Preparing transaction`);
// let tx = Mina.transaction(
//   { sender: deployer, fee: transactionFee },
//   async () => {
//     await rm.commitValue(commit);
//   }
// );

// await tx.prove();
// let txInfo = await tx.sign([deployerKey]).send();

// console.log(`Transaction hash: ${txInfo.hash}`);
// console.log(`Rm address: ${rmAddress.toBase58()}`);

// console.log('Waiting for transaction to be included in block');

// await txInfo.wait();
