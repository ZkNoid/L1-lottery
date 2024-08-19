import dotenv from 'dotenv';
dotenv.config();
import { Mina, PrivateKey, fetchAccount, AccountUpdate, PublicKey } from 'o1js';
import { ZkonZkProgram, ZkonRequestCoordinator } from 'zkon-zkapp';
import { getRandomManager } from '../src/Random/RandomManager.js';
import { getPLottery } from '../src/PLottery.js';

import * as fs from 'fs';
import { DistibutionProgram } from '../src/Proofs/DistributionProof.js';
import { TicketReduceProgram } from '../src/Proofs/TicketReduceProof.js';
import { configDefaultInstance } from './utils.js';

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Network configuration
const { transactionFee } = configDefaultInstance();
// const transactionFee = 500_000_000;
// const useCustomLocalNetwork = process.env.USE_CUSTOM_LOCAL_NETWORK === 'true';
// const network = Mina.Network({
//   mina: useCustomLocalNetwork
//     ? 'http://localhost:8080/graphql'
//     : 'https://api.minascan.io/node/devnet/v1/graphql',
//   lightnetAccountManager: 'http://localhost:8181',
//   archive: useCustomLocalNetwork
//     ? 'http://localhost:8282'
//     : 'https://api.minascan.io/archive/devnet/v1/graphql',
// });
// Mina.setActiveInstance(network);

let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
let deployer = deployerKey.toPublicKey();

let randomManagerOwner = PublicKey.fromBase58(
  process.env.RANDOM_MANAGER_OWNER_ADDRESS!
);

console.log(`Fetching the fee payer account information.`);
const accountDetails = (await fetchAccount({ publicKey: deployer })).account;
console.log(
  `Using the fee payer account ${deployer.toBase58()} with nonce: ${
    accountDetails?.nonce
  } and balance: ${accountDetails?.balance}.`
);

console.log('Compiling proofs');
await ZkonZkProgram.compile();
await ZkonRequestCoordinator.compile();

const randomManagerPrivateKey = PrivateKey.random();
const randomManagerAddress = randomManagerPrivateKey.toPublicKey();

const lotteryPrivateKey = PrivateKey.random();
const lotteryAddress = lotteryPrivateKey.toPublicKey();

// Deploy random manager

console.log(
  `Deploying random manager on address: ${randomManagerAddress.toBase58()}`
);
let RandomManager = getRandomManager(randomManagerOwner);
let randomManager = new RandomManager(randomManagerAddress);
await RandomManager.compile();

let rmDeployTx = await Mina.transaction(
  { sender: deployer, fee: transactionFee },
  async () => {
    AccountUpdate.fundNewAccount(deployer);
    await randomManager.deploy();
  }
);

await rmDeployTx.prove();
let rmDeployTxStatus = await rmDeployTx
  .sign([deployerKey, randomManagerPrivateKey])
  .send();

console.log(
  `Transaction for random manger deploy sent. Hash: ${rmDeployTxStatus.hash}`
);

console.log(`Wait 15 minutes for transaction to complete`);
await wait(15 * 60 * 1000);

// Deploy lottery
console.log(`Deploying lottery on address: ${lotteryAddress.toBase58()}`);
let Lottery = getPLottery(randomManagerAddress, randomManagerAddress);
let lottery = new Lottery(lotteryAddress);
await DistibutionProgram.compile();
await TicketReduceProgram.compile();
await Lottery.compile();

let lotteryDeployTx = await Mina.transaction(
  { sender: deployer, fee: transactionFee },
  async () => {
    AccountUpdate.fundNewAccount(deployer);
    await lottery.deploy();
  }
);

await lotteryDeployTx.prove();
let lotteryDeployTxStatus = await lotteryDeployTx
  .sign([deployerKey, lotteryPrivateKey])
  .send();

console.log(
  `Transaction for lottery deploy sent. Hash: ${lotteryDeployTxStatus.hash}`
);

console.log('Writing addreses to files');
// Store keys
let deployParams: { lastDeploy: number };

if (!fs.existsSync('./deploy')) {
  fs.mkdirSync('./deploy');
}

if (fs.existsSync('./deploy/params.json')) {
  let deployParamsBuffer = fs.readFileSync('./deploy/params.json');
  deployParams = JSON.parse(deployParamsBuffer.toString());
} else {
  deployParams = {
    lastDeploy: 0,
  };
}

deployParams.lastDeploy++;

// Store private keys
let deployedKeys = {
  randomManagerPrivateKey: randomManagerPrivateKey.toBase58(),
  randomManagerAddress: randomManagerAddress.toBase58(),
  lotteryPrivateKey: lotteryPrivateKey.toBase58(),
  lotteryAddress: lotteryAddress.toBase58(),
};

if (!fs.existsSync('./keys/auto')) {
  fs.mkdirSync('./keys/auto', { recursive: true });
}

fs.writeFileSync(
  `./keys/auto/${deployParams.lastDeploy}.json`,
  JSON.stringify(deployedKeys, null, 2),
  { flag: 'wx' }
);

// Store adresses
let addresses = {
  randomManagerAddress: randomManagerAddress.toBase58(),
  lotteryAddress: lotteryAddress.toBase58(),
  randomManagerOwner: randomManagerOwner.toBase58(),
};

if (!fs.existsSync('./deploy/addresses')) {
  fs.mkdirSync('./deploy/addresses', { recursive: true });
}

fs.writeFileSync(
  `./deploy/addresses/${deployParams.lastDeploy}.json`,
  JSON.stringify(addresses, null, 2),
  { flag: 'wx' }
);

fs.writeFileSync(
  `./deploy/addresses/current.json`,
  JSON.stringify(addresses, null, 2)
);

// Update deploy params
fs.writeFileSync(`./deploy/params.json`, JSON.stringify(deployParams, null, 2));

console.log('Done');
let deployParamsT: { lastDeploy: number };

if (fs.existsSync('foo.txt')) {
  let deployParamsBufferT = fs.readFileSync('./deploy/params.json');
  deployParamsT = JSON.parse(deployParamsBufferT.toString());
} else {
  deployParamsT = {
    lastDeploy: 0,
  };
}
