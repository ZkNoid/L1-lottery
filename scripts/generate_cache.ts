import { Cache } from 'o1js';
import { DistibutionProgram } from '../src/DistributionProof.js';
import { PLottery } from '../src/PLottery.js';
import { TicketReduceProgram } from '../src/TicketReduceProof.js';

for (let i = 0; i < 1; i++) {
  console.log(`${i} run`);
  await DistibutionProgram.compile({ cache: Cache.FileSystem('./cache') });
  await TicketReduceProgram.compile({ cache: Cache.FileSystem('./cache') });
  await PLottery.compile({ cache: Cache.FileSystem('./cache') });
}
