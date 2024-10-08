// /**
//  * This script can be used to interact with the Add contract, after deploying it.
//  *
//  * We call the update() method on the contract, create a proof and send it to the chain.
//  * The endpoint that we interact with is read from your config.json.
//  *
//  * This simulates a user interacting with the zkApp from a browser, except that here, sending the transaction happens
//  * from the script and we're using your pre-funded zkApp account to pay the transaction fee. In a real web app, the user's wallet
//  * would send the transaction and pay the fee.
//  *
//  * To run locally:
//  * Build the project: `$ npm run build`
//  * Run with node:     `$ node build/scripts/buy_ticket.js <deployAlias>`.
//  */
// import fs from 'fs/promises';
// import {
//   Cache,
//   Mina,
//   NetworkId,
//   PrivateKey,
//   UInt32,
//   fetchAccount,
//   fetchLastBlock,
// } from 'o1js';
// import { DistributionProgram } from '../src/Proofs/DistributionProof.js';
// import { TicketReduceProgram } from '../src/Proofs/TicketReduceProof.js';
// import { PStateManager } from '../src/StateManager/PStateManager.js';
// import { BLOCK_PER_ROUND } from '../src/constants.js';
// import { findPlottery } from './utils.js';

// // check command line arg
// let deployAlias = process.argv[2];
// if (!deployAlias)
//   throw Error(`Missing <deployAlias> argument.

// Usage:
// node build/src/interact.js <deployAlias>
// `);
// Error.stackTraceLimit = 1000;
// const DEFAULT_NETWORK_ID = 'testnet';

// // parse config and private key from file
// type Config = {
//   deployAliases: Record<
//     string,
//     {
//       networkId?: string;
//       url: string;
//       keyPath: string;
//       fee: string;
//       feepayerKeyPath: string;
//       feepayerAlias: string;
//     }
//   >;
// };
// let configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
// let config = configJson.deployAliases[deployAlias];
// let feepayerKeysBase58: { privateKey: string; publicKey: string } = JSON.parse(
//   await fs.readFile(config.feepayerKeyPath, 'utf8')
// );

// let zkAppKeysBase58: { privateKey: string; publicKey: string } = JSON.parse(
//   await fs.readFile(config.keyPath, 'utf8')
// );

// let feepayerKey = PrivateKey.fromBase58(feepayerKeysBase58.privateKey);
// let zkAppKey = PrivateKey.fromBase58(zkAppKeysBase58.privateKey);

// // set up Mina instance and contract we interact with
// const Network = Mina.Network({
//   // We need to default to the testnet networkId if none is specified for this deploy alias in config.json
//   // This is to ensure the backward compatibility.
//   networkId: (config.networkId ?? DEFAULT_NETWORK_ID) as NetworkId,
//   // graphql: 'https://api.minascan.io/node/devnet/v1/graphql',
//   archive: 'https://api.minascan.io/archive/devnet/v1/graphql',
//   mina: config.url,
// });
// // const Network = Mina.Network(config.url);
// const fee = Number(config.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
// Mina.setActiveInstance(Network);
// let feepayerAddress = feepayerKey.toPublicKey();
// let zkAppAddress = zkAppKey.toPublicKey();
// let { plottery: lottery, PLottery } = findPlottery();

// // compile the contract to create prover keys
// console.log('compile the DP');
// await DistributionProgram.compile();
// console.log('compile reduce proof');
// await TicketReduceProgram.compile();
// console.log('compile the Lottery');
// let lotteryCompileResult = await PLottery.compile();

// // let mockLotteryCompileResult = await MockLottery.compile({
// //   cache: Cache.FileSystem('../cache'),
// // });

// console.log(`Fetch: ${zkAppAddress.toBase58()}`);
// console.log(`Onchain VK: `, lottery.account.verificationKey);
// console.log(
//   `Local VK1: `,
//   lotteryCompileResult.verificationKey.hash.toString()
// );
// // console.log(
// //   `Local VK2: `,
// //   mockLotteryCompileResult.verificationKey.hash.toString()
// // );
// await fetchAccount({ publicKey: zkAppAddress });
// await fetchAccount({
//   publicKey: 'B62qnBkcyABfjz2cqJPzNZKjVt9M9kx1vgoiWLbkJUnk16Cz8KX8qC4',
// });

// console.log(lottery.bankRoot.get().toString());

// console.log(lottery.ticketRoot.get().toString());

// const startSlot = lottery.startBlock.get();

// const state = new PStateManager(lottery, startSlot.value, false);

// // const curSlot = lottery.network.globalSlotSinceGenesis.get();

// // const curRound = curSlot.sub(startSlot).div(BLOCK_PER_ROUND);

// const curRound = UInt32.from(8);

// console.log('Generate reduce proof');
// const reduceProof = await state.reduceTickets();

// // console.log(`Digest: `, await MockLottery.digest());

// console.log('Send reduce transaction');

// let tx = await Mina.transaction({ sender: feepayerAddress, fee }, async () => {
//   await lottery.reduceTickets(reduceProof);
// });
// await tx.prove();
// let txResult = await tx.sign([feepayerKey]).send();

// console.log(`Tx successful. Hash: `, txResult.hash);
