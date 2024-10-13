import fs from 'fs';
import {
  Cache,
  Field,
  Mina,
  NetworkId,
  PrivateKey,
  PublicKey,
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
import axios from 'axios';

const { transactionFee } = configDefaultInstance();

const networkId = Mina.activeInstance.getNetworkId().toString();
const { verificationKey } = await PlotteryFactory.compile();

const deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
const deployer = deployerKey.toPublicKey();

// Get factory
const factoryDataPath = `./deployV2/${networkId}/${verificationKey.hash.toString()}/factory.json`;

const factoryAddress = PublicKey.fromBase58(
  JSON.parse(fs.readFileSync(factoryDataPath).toString()).address
);

console.log(factoryAddress.toBase58());

await fetchAccount({ publicKey: factoryAddress });

const factory = new PlotteryFactory(factoryAddress);
const startSlot = factory.startSlot.get();

const data = await axios.post(
  'https://api.minascan.io/node/devnet/v1/graphql',
  JSON.stringify({
    query: `
  query {
    bestChain(maxLength:1) {
      protocolState {
        consensusState {
          blockHeight,
          slotSinceGenesis
        }
      }
    }
  }
`,
  }),
  {
    headers: {
      'Content-Type': 'application/json',
    },
    responseType: 'json',
  }
);
const currentSlot = UInt32.from(
  data.data.data.bestChain[0].protocolState.consensusState.slotSinceGenesis
);

const currentRound = currentSlot.sub(startSlot).div(BLOCK_PER_ROUND);

const factoryManager = await getFedFactoryManager(factory);

const ticket = Ticket.from([1, 1, 1, 1, 1, 1], deployer, 1);

console.log(`Current round: ${currentRound}`);

const plottery = factoryManager.plotteryManagers[+currentRound].contract;

// compile the contract to create prover keys
console.log('compile the DP');
const dpResult = await DistributionProgram.compile({
  cache: Cache.FileSystem('../cache'),
});
console.log(`DP verification key: ${dpResult.verificationKey.hash.toString()}`);

console.log('compile reduce proof');
const ticketReduceResult = await TicketReduceProgram.compile({
  cache: Cache.FileSystem('../cache'),
});
console.log(
  `Ticket Reduce Result: ${ticketReduceResult.verificationKey.hash.toString()}`
);

console.log('compile the Lottery');
const plotteryResult = await PLottery.compile({
  cache: Cache.FileSystem('../cache'),
});
console.log(
  `Plottery Result: ${plotteryResult.verificationKey.hash.toString()}`
);

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
