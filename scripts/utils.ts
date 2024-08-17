import { Cache, Mina, PublicKey } from 'o1js';
import * as fs from 'fs';
import { PLotteryType, getPLottery } from '../src/PLottery.js';
import { getRandomManager } from '../src/Random/RandomManager.js';
import {
  LotteryAction,
  TicketReduceProgram,
} from '../src/TicketReduceProof.js';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
import { DistibutionProgram } from '../src/DistributionProof.js';

export const configDefaultInstance = (): { transactionFee: number } => {
  const transactionFee = 100_000_000;
  const useCustomLocalNetwork = process.env.USE_CUSTOM_LOCAL_NETWORK === 'true';
  const network = Mina.Network({
    mina: useCustomLocalNetwork
      ? 'http://localhost:8080/graphql'
      : 'https://api.minascan.io/node/devnet/v1/graphql',
    lightnetAccountManager: 'http://localhost:8181',
    archive: useCustomLocalNetwork
      ? 'http://localhost:8282'
      : 'https://api.minascan.io/archive/devnet/v1/graphql',
  });
  Mina.setActiveInstance(network);

  return { transactionFee };
};

export const findPlottery = (epoch: string = 'current') => {
  let addressesBuffer = fs.readFileSync(`./deploy/addresses/${epoch}.json`);
  let addresses: {
    randomManagerAddress: string;
    lotteryAddress: string;
    randomManagerOwner: string;
  } = JSON.parse(addressesBuffer.toString());

  let randomManagerAddress = PublicKey.fromBase58(
    addresses.randomManagerAddress
  );
  let lotteryAddress = PublicKey.fromBase58(addresses.lotteryAddress);
  let randomManagerOwner = PublicKey.fromBase58(addresses.randomManagerOwner);

  let PLottery = getPLottery(randomManagerAddress, randomManagerOwner);
  let plottery = new PLottery(lotteryAddress);

  return {
    PLottery, // Class
    plottery, // Instance
  };
};

export const findRandomManager = (epoch: string = 'current') => {
  let addressesBuffer = fs.readFileSync(`./deploy/addresses/${epoch}.json`);
  let addresses: {
    randomManagerAddress: string;
    lotteryAddress: string;
    randomManagerOwner: string;
  } = JSON.parse(addressesBuffer.toString());

  let randomManagerOwner = PublicKey.fromBase58(addresses.randomManagerOwner);
  let randomManagerAddress = PublicKey.fromBase58(
    addresses.randomManagerAddress
  );
  let RandomManager = getRandomManager(randomManagerOwner);
  let randomManager = new RandomManager(randomManagerAddress);

  return {
    RandomManager,
    randomManager,
  };
};

export const compileRandomManager = async (epoch: string = 'current') => {
  let { RandomManager, randomManager } = findRandomManager(epoch);

  await ZkonZkProgram.compile({ cache: Cache.FileSystem('./cache/ZKOn') });
  await ZkonRequestCoordinator.compile({
    cache: Cache.FileSystem('./cache/ZKOn'),
  });
  await RandomManager.compile({
    cache: Cache.FileSystem(
      `./cache/RandomManager/${randomManager.address.toBase58()}`
    ),
  });
};

export const compilePlottery = async (epoch: string = 'current') => {
  let { PLottery, plottery } = findPlottery(epoch);

  await DistibutionProgram.compile({ cache: Cache.FileSystem('./cache/DP') });
  await TicketReduceProgram.compile({ cache: Cache.FileSystem('./cache/TRP') });

  await PLottery.compile({
    cache: Cache.FileSystem(`./cache/PLottery/${plottery.address.toBase58()}`),
  });
};