import { AccountUpdate, fetchAccount, Mina, PrivateKey } from 'o1js';
import { configDefaultInstance } from './utils.js';
import { PlotteryFactory } from '../src/FactoryTwoParties.js';
import * as fs from 'fs';

const { transactionFee } = configDefaultInstance();
const networkId = Mina.activeInstance.getNetworkId().toString();

let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
let deployer = deployerKey.toPublicKey();

console.log(`Deploying with ${deployer.toBase58()}`);

console.log(`Compiling PlotteryFactory`);
let { verificationKey } = await PlotteryFactory.compile();

const factoryDataPath = `./deployV2/${networkId}/${verificationKey.hash.toString()}/factory.json`;

if (fs.existsSync(factoryDataPath)) {
  throw Error('Contract with same verification key already deployed');
}

await fetchAccount({
  publicKey: 'B62qnBkcyABfjz2cqJPzNZKjVt9M9kx1vgoiWLbkJUnk16Cz8KX8qC4',
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
let txInfo = await tx.sign([deployerKey, factoryKey]).send();

let deploymentData = {
  address: factoryAddress.toBase58(),
  key: factoryKey.toBase58(),
};

if (
  !fs.existsSync(`./deployV2/${networkId}/${verificationKey.hash.toString()}`)
) {
  fs.mkdirSync(`./deployV2/${networkId}/${verificationKey.hash.toString()}`, {
    recursive: true,
  });
}

fs.writeFileSync(
  `./deployV2/${networkId}/${verificationKey.hash.toString()}/factory.json`,
  JSON.stringify(deploymentData, null, 2)
);

console.log(`Transaction hash: ${txInfo.hash}`);

console.log('Waiting for transaction to be included in block');

await txInfo.wait();
