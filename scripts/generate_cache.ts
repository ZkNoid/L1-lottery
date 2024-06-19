import { Cache } from 'o1js';
import { DistibutionProgram } from '../src/DistributionProof.js';
import { Lottery } from '../src/Lottery.js';

for (let i = 0; i < 5; i++) {
  console.log(`${i} run`);
  await DistibutionProgram.compile({ cache: Cache.FileSystem('./cache') });
  await Lottery.compile({ cache: Cache.FileSystem('./cache') });
}
