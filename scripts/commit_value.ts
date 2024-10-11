import { AccountUpdate, Field, Mina, PrivateKey, PublicKey } from 'o1js';
import { DeployEvent, PlotteryFactory } from '../src/Factory.js';
import { FactoryManager } from '../src/StateManager/FactoryStateManager.js';
import { configDefaultInstance, getFedFactoryManager } from './utils.js';
import * as fs from 'fs';
import { CommitValue, RandomManager } from '../src/Random/RandomManager.js';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';

let { transactionFee } = configDefaultInstance();

let deployerKey = PrivateKey.fromBase58(process.env.BACKEND_KEY!);
let deployer = deployerKey.toPublicKey();

console.log(`Using deployer ${deployer.toBase58()}`);

console.log(`Compiling PlotteryFactory`);

const networkId = Mina.activeInstance.getNetworkId().toString();

let { verificationKey } = await PlotteryFactory.compile();

console.log(`Factory verification key: ${verificationKey.hash.toString()}`);

let factoryAddress: PublicKey;

if (
  !fs.existsSync(`./deployV2/${networkId}/${verificationKey.hash.toString()}`)
) {
  throw Error(`No factory deployment found. Deploy it first`);
}

const factoryDataPath = `./deployV2/${networkId}/${verificationKey.hash.toString()}/factory.json`;
if (fs.existsSync(factoryDataPath)) {
  let factoryData = fs.readFileSync(factoryDataPath);
  factoryAddress = PublicKey.fromBase58(
    JSON.parse(factoryData.toString()).address
  );
} else {
  throw Error(`No factory deployment found. Deploy it first`);
}

console.log('ZkonZkProgramm compile');
await ZkonZkProgram.compile({
  // cache: Cache.FileSystem('./cache'),
});

console.log('ZkonRequestCoordinator compile');
let coordinator = await ZkonRequestCoordinator.compile({
  // cache: Cache.FileSystem('./cache'),
});

console.log(coordinator.verificationKey.hash.toString());

console.log('RandomManager compile');
const randomManagerCompileInfo = await RandomManager.compile({
  // cache: Cache.FileSystem('./cache'),
});

let factory = new PlotteryFactory(factoryAddress);

let deployments;

const deploymentsPath = `./deployV2/${networkId}/${verificationKey.hash.toString()}/deployments.json`;

if (fs.existsSync(deploymentsPath)) {
  let deploymentsBuffer = fs.readFileSync(deploymentsPath);
  deployments = JSON.parse(deploymentsBuffer.toString());
} else {
  deployments = {};
}

const factoryManager = await getFedFactoryManager(factory);

const rm1 = factoryManager.randomManagers[0].contract;

const commitValue = new CommitValue({
  value: Field(1),
  salt: Field(1),
});

let tx = Mina.transaction(
  { sender: deployer, fee: 5 * transactionFee },
  async () => {
    await rm1.commitValue(commitValue);
  }
);

await tx.prove();
let txInfo = await tx.sign([deployerKey]).send();

const txResult = await txInfo.safeWait();

console.log(`Tx hash: ${txResult.hash.toString()}`);
