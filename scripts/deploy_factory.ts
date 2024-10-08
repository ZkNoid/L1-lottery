import { AccountUpdate, Mina, PrivateKey } from 'o1js';
import { configDefaultInstance } from './utils';
import { PlotteryFactory } from '../src/Factory';
import * as fs from 'fs';

configDefaultInstance();

let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
let deployer = deployerKey.toPublicKey();

let { verificationKey } = await PlotteryFactory.compile();

const factoryDataPath = `./deployV2/${verificationKey.hash.toString()}/factory.json`;

if (fs.existsSync(factoryDataPath)) {
  throw Error('Contract with same verification key already deployed');
}

let factoryKey = PrivateKey.random();
let factoryAddress = factoryKey.toPublicKey();

let factory = new PlotteryFactory(factoryAddress);

let tx = Mina.transaction(deployer, async () => {
  AccountUpdate.fundNewAccount(deployer);
  factory.deploy();
});

await tx.prove();
await tx.sign([deployerKey, factoryKey]).send();

let deploymentData = {
  address: factoryAddress.toBase58(),
  key: factoryKey.toBase58(),
};

if (!fs.existsSync(`./deployV2/${verificationKey.hash.toString()}`)) {
  fs.mkdirSync(`./deployV2/${verificationKey.hash.toString()}`, {
    recursive: true,
  });
}

fs.writeFileSync(
  `./deployV2/${verificationKey.hash.toString()}/factory.json`,
  JSON.stringify(deploymentData, null, 2)
);
