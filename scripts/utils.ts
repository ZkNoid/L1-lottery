import dotenv from 'dotenv';
dotenv.config();
import { Cache, Field, Mina, PrivateKey, PublicKey } from 'o1js';
import {
  LotteryAction,
  TicketReduceProgram,
} from '../src/Proofs/TicketReduceProof.js';
import {
  StringCircuitValue,
  ZkonRequestCoordinator,
  ZkonZkProgram,
} from 'zkon-zkapp';
import { DistributionProgram } from '../src/Proofs/DistributionProof.js';
import { ZkOnCoordinatorAddress } from '../src/constants.js';
import { RandomManagerManager } from '../src/StateManager/RandomManagerManager.js';
import { FactoryManager } from '../src/StateManager/FactoryStateManager.js';
import { PlotteryFactory } from '../src/Factory.js';
import { cidBuffer } from '../random_request_cid.js';

export const configDefaultInstance = (): { transactionFee: number } => {
  const transactionFee = 100_000_000;
  const useCustomLocalNetwork = process.env.USE_CUSTOM_LOCAL_NETWORK === 'true';
  const useMainnet = process.env.MAINNET === 'true';

  const network = Mina.Network({
    networkId: useMainnet ? 'mainnet' : 'testnet',
    mina: useCustomLocalNetwork
      ? 'http://localhost:8080/graphql'
      : useMainnet ? 'https://api.minascan.io/node/mainnet/v1/graphql'
      : 'https://api.minascan.io/node/devnet/v1/graphql',
    lightnetAccountManager: 'http://localhost:8181',
    archive: useCustomLocalNetwork
      ? 'http://localhost:8282'
      : useMainnet ? 'https://api.minascan.io/node/mainnet/v1/graphql'
      : 'https://api.minascan.io/archive/devnet/v1/graphql',
  });
  Mina.setActiveInstance(network);

  return { transactionFee };
};
/*
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

  let PLottery = getPLottery(
    randomManagerAddress,
    randomManagerOwner,
    ZkOnCoordinatorAddress
  );
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
  let RandomManager = getRandomManager(
    randomManagerOwner,
    ZkOnCoordinatorAddress
  );
  let randomManager = new RandomManager(randomManagerAddress);

  return {
    RandomManager,
    randomManager,
  };
};

export const getRMStoreManager = (
  epoch: string = 'current'
): RandomManagerManager => {
  let addressesBuffer = fs.readFileSync(`./deploy/addresses/${epoch}.json`);
  let addresses: {
    randomManagerAddress: string;
    lotteryAddress: string;
    randomManagerOwner: string;
  } = JSON.parse(addressesBuffer.toString());

  const rmPath = `./store/RM/${addresses.randomManagerAddress}.json`;

  if (!fs.existsSync(rmPath)) {
    return new RandomManagerManager();
  }

  let rmBuffer = fs.readFileSync(rmPath);
  return RandomManagerManager.fromJSON(rmBuffer.toString());
};

export const storeRMStoreManager = (
  rmStoreManager: RandomManagerManager,
  epoch: string = 'current'
) => {
  let addressesBuffer = fs.readFileSync(`./deploy/addresses/${epoch}.json`);
  let addresses: {
    randomManagerAddress: string;
    lotteryAddress: string;
    randomManagerOwner: string;
  } = JSON.parse(addressesBuffer.toString());

  const rmPath = `./store/RM/${addresses.randomManagerAddress}.json`;

  if (!fs.existsSync(`./store/RM/`)) {
    fs.mkdirSync('./store/RM/');
  }

  fs.writeFileSync(rmPath, rmStoreManager.toJSON());
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

  await DistributionProgram.compile({ cache: Cache.FileSystem('./cache/DP') });
  await TicketReduceProgram.compile({ cache: Cache.FileSystem('./cache/TRP') });

  await PLottery.compile({
    cache: Cache.FileSystem(`./cache/PLottery/${plottery.address.toBase58()}`),
  });
};

export const getDeployer = (): {
  deployer: PublicKey;
  deployerKey: PrivateKey;
} => {
  let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
  let deployer = deployerKey.toPublicKey();

  return {
    deployer,
    deployerKey,
  };
};
*/

export const getFedFactoryManager = async (
  factory: PlotteryFactory
): Promise<FactoryManager> => {
  const factoryManager = new FactoryManager();

  const factoryEvents = await factory.fetchEvents();

  for (const event of factoryEvents) {
    const deployEvent = event.event.data as any;

    console.log('event');
    console.log(deployEvent);
    factoryManager.addDeploy(
      +deployEvent.round,
      deployEvent.randomManager,
      deployEvent.plottery
    );
  }

  return factoryManager;
};

export const getIPFSCID = (): { hashPart1: Field; hashPart2: Field } => {
  function segmentHash(ipfsHashFile: string) {
    const ipfsHash0 = ipfsHashFile.slice(0, 30); // first part of the ipfsHash
    const ipfsHash1 = ipfsHashFile.slice(30); // second part of the ipfsHash

    const hashPart1 = new StringCircuitValue(ipfsHash0).toField();

    const hashPart2 = new StringCircuitValue(ipfsHash1).toField();

    return { hashPart1, hashPart2 };
  }

  return segmentHash(cidBuffer.toString());
};
