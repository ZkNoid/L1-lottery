import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { Cache, Mina } from 'o1js';
import { RandomManager } from '../src/Random/RandomManager.js';
import { TicketReduceProgram } from '../src/Proofs/TicketReduceProof.js';
import { DistributionProgram } from '../src/Proofs/DistributionProof.js';
import { PLottery } from '../src/PLottery.js';

import { PlotteryFactory } from '../src/Factory.js';
import { NETWORKS } from '../src/constants/networks.js';
import { vkJSON } from '../vk.js';

const network_ = NETWORKS[process.env.NETWORK_ID!];

if (!network_) {
  console.log('Network is not chosen. Set env variable NETWORK_ID');
}
console.log('Network choosing', network_);

const Network = Mina.Network({
  networkId: network_?.isMainnet ? 'mainnet' : 'testnet',
  mina: network_?.graphql,
  archive: network_?.archive,
});

Mina.setActiveInstance(Network);

const { verificationKey: factoryVK } =
  await PlotteryFactory.compile();

const { verificationKey: randomManagerVK } = await RandomManager.compile();

await TicketReduceProgram.compile({ cache: Cache.FileSystem('cache') });
await DistributionProgram.compile({ cache: Cache.FileSystem('cache') });
const { verificationKey: PLotteryVK } = await PLottery.compile({
  cache: Cache.FileSystem('cache'),
});

const result = {
  factoryVK: {
    hash: factoryVK.hash.toString(),
    data: factoryVK.data,
  },
  randomManagerVK: {
    hash: randomManagerVK.hash.toString(),
    data: randomManagerVK.data,
  },
  PLotteryVK: {
    hash: PLotteryVK.hash.toString(),
    data: PLotteryVK.data,
  },
};

console.log(result);

console.log('RandomManager compile');
const randomManagerCompileInfo = await RandomManager.compile({
  cache: Cache.FileSystem('./cache'),
});

const lotteryCompileInfo = await PLottery.compile({
  cache: Cache.FileSystem('./cache'),
});

console.log(`rm verification key`);
console.log(randomManagerCompileInfo.verificationKey.hash.toString());

console.log('Factory compile');
const factoryCompileInfo = await PlotteryFactory.compile({
  cache: Cache.FileSystem('./cache'),
});

console.log(`fc verification key`);
console.log(factoryCompileInfo.verificationKey.hash.toString());

console.log(`lm verification key`);
console.log(lotteryCompileInfo.verificationKey.hash.toString());

let savedVks = {
  ...vkJSON,
} as any;

savedVks[network_.networkID] = result;

fs.writeFileSync(
  'vk.js',
  `export const vkJSON = ${JSON.stringify(savedVks, null, 2)}`
);
