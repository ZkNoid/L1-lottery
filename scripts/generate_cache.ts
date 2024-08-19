import * as fs from 'fs';
import { Cache, PublicKey } from 'o1js';
import { DistibutionProgram } from '../src/Proofs/DistributionProof.js';
import { TicketReduceProgram } from '../src/Proofs/TicketReduceProof.js';
import { getPLottery } from '../src/PLottery.js';
import { getRandomManager } from '../src/Random/RandomManager.js';

// If no epoch is provided - last one will be used
let deploy_epoch = process.argv[2] ? process.argv[2] : 'current';

let addressesBuffer = fs.readFileSync(
  `./deploy/addresses/${deploy_epoch}.json`
);
let addresses: {
  randomManagerAddress: string;
  lotteryAddress: string;
  randomManagerOwner: string;
} = JSON.parse(addressesBuffer.toString());

let randomManagerAddress = PublicKey.fromBase58(addresses.randomManagerAddress);
let lotteryAddress = PublicKey.fromBase58(addresses.lotteryAddress);
let randomManagerOwner = PublicKey.fromBase58(addresses.randomManagerOwner);

await DistibutionProgram.compile({ cache: Cache.FileSystem('./cache/DP') });
await TicketReduceProgram.compile({ cache: Cache.FileSystem('./cache/TRP') });

let RandomManager = getRandomManager(randomManagerOwner);

let PLottery = getPLottery(randomManagerAddress, randomManagerOwner);

await RandomManager.compile({
  cache: Cache.FileSystem(
    `./cache/RandomManager/${addresses.randomManagerAddress}`
  ),
});

await PLottery.compile({
  cache: Cache.FileSystem(`./cache/PLottery/${addresses.lotteryAddress}`),
});
