import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { Cache, Field, Mina } from 'o1js';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
import { RandomManager as RandomManagerTwoParties } from '../src/Random/RandomManagerTwoParties.js';
import { RandomManager } from '../src/Random/RandomManager.js';
import { TicketReduceProgram } from '../src/Proofs/TicketReduceProof.js';
import { DistributionProgram } from '../src/Proofs/DistributionProof.js';
import { PLottery } from '../src/PLottery.js';
import { FactoryTwoParties } from '../src/index.js';
import { PlotteryFactory } from '../src/index_two_parties.js';
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

await ZkonZkProgram.compile({ cache: Cache.FileSystem('cache') });
await ZkonRequestCoordinator.compile({ cache: Cache.FileSystem('cache') });
const { verificationKey: factoryTwoPartiesVK } =
  await FactoryTwoParties.PlotteryFactory.compile();

const { verificationKey: randomManagerVK } = await RandomManager.compile();
const { verificationKey: randomManagerTwoPartiesVK } =
  await RandomManagerTwoParties.compile();

await TicketReduceProgram.compile({ cache: Cache.FileSystem('cache') });
await DistributionProgram.compile({ cache: Cache.FileSystem('cache') });
const { verificationKey: PLotteryVK } = await PLottery.compile({
  cache: Cache.FileSystem('cache'),
});

const result = {
  factoryTwoPartiesVK: {
    hash: factoryTwoPartiesVK.hash.toString(),
    data: factoryTwoPartiesVK.data,
  },
  randomManagerVK: {
    hash: randomManagerVK.hash.toString(),
    data: randomManagerVK.data,
  },
  randomManagerTwoParties: {
    hash: randomManagerTwoPartiesVK.hash.toString(),
    data: randomManagerTwoPartiesVK.data,
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
  ...vkJSON
} as any;

savedVks[network_.networkID] = result;

fs.writeFileSync(
  'vk.js',
  `export const vkJSON = ${JSON.stringify(savedVks, null, 2)}`
);
