import { AccountUpdate, fetchAccount, Mina, PrivateKey, PublicKey } from 'o1js';
import { configDefaultInstance } from './utils.js';
import { PlotteryFactory } from '../src/Factory.js';
import * as fs from 'fs';
import { treasury } from '../src/constants.js';

const { transactionFee } = configDefaultInstance();
const networkId = Mina.activeInstance.getNetworkId().toString();
const name = process.argv[2]; // Get optional name parameter from command line

console.log('Network id', networkId);
if (name) {
  console.log('Deployment name:', name);
}

let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
let deployer = deployerKey.toPublicKey();

console.log(`Deploying with ${deployer.toBase58()}`);

console.log(`Compiling PlotteryFactory`);
let { verificationKey } = await PlotteryFactory.compile();

const basePath = name
  ? `./deployV2/${networkId}/${name}`
  : `./deployV2/${networkId}/${verificationKey.hash.toString()}`;
const factoryDataPath = `${basePath}/factory.json`;

if (fs.existsSync(factoryDataPath)) {
  throw Error('Contract with same verification key already deployed');
}

await fetchAccount({
  publicKey: treasury,
});

await fetchAccount({
  publicKey: deployer,
});

let factoryKey = PrivateKey.random();
let factoryAddress = factoryKey.toPublicKey();

let factory = new PlotteryFactory(factoryAddress);

console.log(`Preparing transaction`);
let tx = Mina.transaction(
  { sender: deployer, fee: transactionFee },
  async () => {
    AccountUpdate.fundNewAccount(deployer);
    factory.deploy();
  }
);

await tx.prove();
let txInfo = await tx.sign([factoryKey, deployerKey]).send();

let deploymentData = {
  address: factoryAddress.toBase58(),
  key: factoryKey.toBase58(),
};

if (!fs.existsSync(basePath)) {
  fs.mkdirSync(basePath, {
    recursive: true,
  });
}

fs.writeFileSync(factoryDataPath, JSON.stringify(deploymentData, null, 2));

console.log(`Transaction hash: ${txInfo.hash}`);

console.log('Waiting for transaction to be included in block');

await txInfo.wait();
