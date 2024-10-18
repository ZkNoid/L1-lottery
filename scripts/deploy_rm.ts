import { AccountUpdate, fetchAccount, Mina, PrivateKey, Cache } from 'o1js';
import { configDefaultInstance } from './utils.js';
import { PlotteryFactory } from '../src/Factory.js';
import * as fs from 'fs';
import { RandomManager } from '../src/Random/RandomManager.js';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';

const { transactionFee } = configDefaultInstance();
const networkId = Mina.activeInstance.getNetworkId().toString();

let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
let deployer = deployerKey.toPublicKey();

console.log(`Deploying with ${deployer.toBase58()}`);

console.log(`Compiling Random manager`);
await ZkonZkProgram.compile({ cache: Cache.FileSystem('cache') });
await ZkonRequestCoordinator.compile({ cache: Cache.FileSystem('cache') });

await RandomManager.compile({
  cache: Cache.FileSystem(`cache`),
});

await fetchAccount({
  publicKey: 'B62qnBkcyABfjz2cqJPzNZKjVt9M9kx1vgoiWLbkJUnk16Cz8KX8qC4',
});

let rmKey = PrivateKey.random();
let rmAddress = rmKey.toPublicKey();

let rm = new RandomManager(rmAddress);

console.log(`Preparing transaction`);
let tx = Mina.transaction(
  { sender: deployer, fee: transactionFee },
  async () => {
    AccountUpdate.fundNewAccount(deployer);
    rm.deploy();
  }
);

await tx.prove();
let txInfo = await tx.sign([deployerKey, rmKey]).send();

console.log(`Transaction hash: ${txInfo.hash}`);
console.log(`Rm address: ${rmAddress.toBase58()}`);

console.log('Waiting for transaction to be included in block');

await txInfo.wait();
