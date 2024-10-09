import fs from 'fs';
import {
  Cache,
  Field,
  Mina,
  NetworkId,
  PrivateKey,
  UInt32,
  fetchAccount,
} from 'o1js';
import { DistributionProgram } from '../src/Proofs/DistributionProof.js';
import { Ticket } from '../src/Structs/Ticket.js';
import { TicketReduceProgram } from '../src/Proofs/TicketReduceProof.js';
import { PStateManager } from '../src/StateManager/PStateManager.js';
import { configDefaultInstance, getFedFactoryManager } from './utils.js';
import { PlotteryFactory } from '../src/Factory.js';
import { BLOCK_PER_ROUND } from '../src/constants.js';
import { PLottery } from '../src/PLottery.js';

const { transactionFee } = configDefaultInstance();

const networkId = Mina.activeInstance.getNetworkId().toString();
const { verificationKey } = await PlotteryFactory.compile();

const deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
const deployer = deployerKey.toPublicKey();

// Get factory
const factoryDataPath = `./deployV2/${networkId}/${verificationKey.hash.toString()}/factory.json`;

const factoryAddress = JSON.parse(
  fs.readFileSync(factoryDataPath).toString()
).address;

const factory = new PlotteryFactory(factoryAddress);
const startSlot = factory.startSlot.get();
const currentSlot = Mina.currentSlot();
const currentRound = currentSlot.sub(startSlot).div(BLOCK_PER_ROUND);

const factoryManager = await getFedFactoryManager(factory);

const ticket = Ticket.from([1, 1, 1, 1, 1, 1], deployer, 1);

const plottery = factoryManager.plotteryManagers[+currentRound].contract;

// compile the contract to create prover keys
console.log('compile the DP');
await DistributionProgram.compile({ cache: Cache.FileSystem('../cache') });
console.log('compile reduce proof');
await TicketReduceProgram.compile({ cache: Cache.FileSystem('../cache') });
console.log('compile the Lottery');
await PLottery.compile({
  cache: Cache.FileSystem('../cache'),
});

await fetchAccount({ publicKey: plottery.address });
await fetchAccount({
  publicKey: deployer,
});

let tx = await Mina.transaction(
  { sender: deployer, fee: transactionFee },
  async () => {
    await plottery.buyTicket(ticket);
  }
);
await tx.prove();
let txResult = await tx.sign([deployerKey]).send();

console.log(`Tx successful. Hash: `, txResult.hash);
