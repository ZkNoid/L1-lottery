import fs from 'fs/promises';
import { AccountUpdate, Lightnet, Mina, NetworkId, PrivateKey } from 'o1js';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
import { getRandomManager } from '../../src/Random/RandomManager';
import { getPLottery } from '../../src/PLottery';
import { DistibutionProgram } from '../../src/Proofs/DistributionProof';
import { TicketReduceProgram } from '../../src/Proofs/TicketReduceProof';

export const deployToLightnet = async () => {
  Error.stackTraceLimit = 1000;
  const DEFAULT_NETWORK_ID = 'testnet';

  const Network = Mina.Network({
    // We need to default to the testnet networkId if none is specified for this deploy alias in config.json
    // This is to ensure the backward compatibility.
    mina: 'http://localhost:8080/graphql',
    archive: 'http://localhost:8282',
    lightnetAccountManager: 'http://localhost:8181',
  });

  const fee = 1e9; // in nanomina (1 billion = 1.0 mina)
  Mina.setActiveInstance(Network);

  const deployer = await Lightnet.acquireKeyPair();

  const randomManagerKeys = PrivateKey.randomKeypair();
  const plotteryKeys = PrivateKey.randomKeypair();

  // Compile everything
  await ZkonZkProgram.compile();
  await ZkonRequestCoordinator.compile();

  let RandomManager = getRandomManager(deployer.publicKey);
  let randomManager = new RandomManager(randomManagerKeys.publicKey);
  await RandomManager.compile();

  let rmDeployTx = await Mina.transaction(
    { sender: deployer.publicKey, fee },
    async () => {
      AccountUpdate.fundNewAccount(randomManagerKeys.publicKey);
      await randomManager.deploy();
    }
  );

  await rmDeployTx.prove();
  let rmDeployTxStatus = await rmDeployTx
    .sign([deployer.privateKey, randomManagerKeys.privateKey])
    .send();

  let Lottery = getPLottery(randomManagerKeys.publicKey, deployer.publicKey);
  let lottery = new Lottery(plotteryKeys.publicKey);
  await DistibutionProgram.compile();
  await TicketReduceProgram.compile();
  await Lottery.compile();

  let lotteryDeployTx = await Mina.transaction(
    { sender: deployer.publicKey, fee },
    async () => {
      AccountUpdate.fundNewAccount(deployer.publicKey);
      await lottery.deploy();
    }
  );

  await lotteryDeployTx.prove();
  let lotteryDeployTxStatus = await lotteryDeployTx
    .sign([deployer.privateKey, plotteryKeys.privateKey])
    .send();

  return {
    lottery,
    randomManager,
  };
};
