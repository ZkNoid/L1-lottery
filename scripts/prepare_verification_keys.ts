import fs from 'fs';
import { Cache, Field } from 'o1js';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
import { RandomManager as RandomManagerTwoParties } from '../src/Random/RandomManagerTwoParties.js';
import { RandomManager } from '../src/Random/RandomManagerTwoParties.js';
import { TicketReduceProgram } from '../src/Proofs/TicketReduceProof.js';
import { DistributionProgram } from '../src/Proofs/DistributionProof.js';
import { PLottery } from '../src/PLottery.js';

await ZkonZkProgram.compile({ cache: Cache.FileSystem('cache') });
await ZkonRequestCoordinator.compile({ cache: Cache.FileSystem('cache') });
const { verificationKey: randomManagerVK } = await RandomManager.compile();
const { verificationKey: randomManagerTwoPartiesVK } = await RandomManagerTwoParties.compile();

await TicketReduceProgram.compile({ cache: Cache.FileSystem('cache') });
await DistributionProgram.compile({ cache: Cache.FileSystem('cache') });
const { verificationKey: PLotteryVK } = await PLottery.compile({
  cache: Cache.FileSystem('cache'),
});

const result = {
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

fs.writeFileSync(
  'vk.js',
  `export const vkJSON = ${JSON.stringify(result, null, 2)}`
);
