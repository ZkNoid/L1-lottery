/**
 * This script can be used to interact with the Add contract, after deploying it.
 *
 * We call the update() method on the contract, create a proof and send it to the chain.
 * The endpoint that we interact with is read from your config.json.
 *
 * This simulates a user interacting with the zkApp from a browser, except that here, sending the transaction happens
 * from the script and we're using your pre-funded zkApp account to pay the transaction fee. In a real web app, the user's wallet
 * would send the transaction and pay the fee.
 *
 * To run locally:
 * Build the project: `$ npm run build`
 * Run with node:     `$ node build/scripts/buy_ticket.js <deployAlias>`.
 */
import fs from 'fs/promises';
import { Cache, Field, Mina, NetworkId, PrivateKey, fetchAccount } from 'o1js';
import { DistibutionProgram } from '../src/DistributionProof.js';
import { Ticket } from '../src/Ticket.js';
import { PLottery } from '../src/PLottery.js';
import { TicketReduceProgram } from '../src/TicketReduceProof.js';
import { PStateManager } from '../src/StateManager/PStateManager.js';

// check command line arg
let deployAlias = process.argv[2];
if (!deployAlias)
  throw Error(`Missing <deployAlias> argument.

Usage:
node build/src/interact.js <deployAlias>
`);
Error.stackTraceLimit = 1000;
const DEFAULT_NETWORK_ID = 'testnet';

// parse config and private key from file
type Config = {
  deployAliases: Record<
    string,
    {
      networkId?: string;
      url: string;
      keyPath: string;
      fee: string;
      feepayerKeyPath: string;
      feepayerAlias: string;
    }
  >;
};
let configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
let config = configJson.deployAliases[deployAlias];
let feepayerKeysBase58: { privateKey: string; publicKey: string } = JSON.parse(
  await fs.readFile(config.feepayerKeyPath, 'utf8')
);

let zkAppKeysBase58: { privateKey: string; publicKey: string } = JSON.parse(
  await fs.readFile(config.keyPath, 'utf8')
);

let feepayerKey = PrivateKey.fromBase58(feepayerKeysBase58.privateKey);
let zkAppKey = PrivateKey.fromBase58(zkAppKeysBase58.privateKey);

// set up Mina instance and contract we interact with
const Network = Mina.Network({
  // We need to default to the testnet networkId if none is specified for this deploy alias in config.json
  // This is to ensure the backward compatibility.
  networkId: (config.networkId ?? DEFAULT_NETWORK_ID) as NetworkId,
  mina: config.url,
});
// const Network = Mina.Network(config.url);
const fee = Number(config.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
Mina.setActiveInstance(Network);
let feepayerAddress = feepayerKey.toPublicKey();
let zkAppAddress = zkAppKey.toPublicKey();
let lottery = new PLottery(zkAppAddress);

// compile the contract to create prover keys
console.log('compile the DP');
await DistibutionProgram.compile();
console.log('compile reduce proof');
await TicketReduceProgram.compile();
console.log('compile the Lottery');
let lotteryCompileResult = await PLottery.compile();
// let mockLotteryCompileResult = await MockLottery.compile({
//   cache: Cache.FileSystem('../cache'),
// });

console.log(`Fetch: ${zkAppAddress.toBase58()}`);
console.log(`Onchain VK: `, lottery.account.verificationKey);
console.log(
  `Local VK1: `,
  lotteryCompileResult.verificationKey.hash.toString()
);
// console.log(
//   `Local VK2: `,
//   mockLotteryCompileResult.verificationKey.hash.toString()
// );
await fetchAccount({ publicKey: zkAppAddress });
await fetchAccount({
  publicKey: 'B62qj3DYVUCaTrDnFXkJW34xHUBr9zUorg72pYN3BJTGB4KFdpYjxxQ',
});

console.log(lottery.bankRoot.get().toString());

console.log(lottery.ticketRoot.get().toString());

const state = new PStateManager(lottery, lottery.startBlock.get().value);

const ticket = Ticket.from([1, 1, 1, 1, 1, 1], feepayerAddress, 1);

// console.log(`Digest: `, await MockLottery.digest());

let tx = await Mina.transaction({ sender: feepayerAddress, fee }, async () => {
  await lottery.buyTicket(ticket, Field(0));
});
await tx.prove();
let txResult = await tx.sign([feepayerKey]).send();

console.log(`Tx successful. Hash: `, txResult.hash);

/*
try {
  // call update() and send transaction
  console.log('build transaction and create proof...');
  let tx = await Mina.transaction(
    { sender: feepayerAddress, fee },
    async () => {
      await zkApp.update();
    }
  );
  await tx.prove();

  console.log('send transaction...');
  const sentTx = await tx.sign([feepayerKey]).send();
  if (sentTx.status === 'pending') {
    console.log(
      '\nSuccess! Update transaction sent.\n' +
        '\nYour smart contract state will be updated' +
        '\nas soon as the transaction is included in a block:' +
        `\n${getTxnUrl(config.url, sentTx.hash)}`
    );
  }
} catch (err) {
  console.log(err);
}

function getTxnUrl(graphQlUrl: string, txnHash: string | undefined) {
  const hostName = new URL(graphQlUrl).hostname;
  const txnBroadcastServiceName = hostName
    .split('.')
    .filter((item) => item === 'minascan')?.[0];
  const networkName = graphQlUrl
    .split('/')
    .filter((item) => item === 'mainnet' || item === 'devnet')?.[0];
  if (txnBroadcastServiceName && networkName) {
    return `https://minascan.io/${networkName}/tx/${txnHash}?type=zk-tx`;
  }
  return `Transaction hash: ${txnHash}`;
}
*/
