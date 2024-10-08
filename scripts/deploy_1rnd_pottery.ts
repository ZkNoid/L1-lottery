import { Field, Mina, PrivateKey, PublicKey } from 'o1js';
import { DeployEvent, PlotteryFactory } from '../src/Factory';
import { FactoryManager } from '../src/StateManager/FactoryStateManager';
import { configDefaultInstance } from './utils';
import * as fs from 'fs';

configDefaultInstance();

let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
let deployer = deployerKey.toPublicKey();

let from = process.argv[2];

let to = process.argv[3];

if (!from || !to) {
  throw Error(`You should provide from round and to round`);
}

let { verificationKey } = await PlotteryFactory.compile();

const factoryManager = new FactoryManager();

let factoryAddress: PublicKey;

const factoryDataPath = `./deployV2/${verificationKey.hash.toString()}/factory.json`;
if (fs.existsSync(factoryDataPath)) {
  let factoryData = fs.readFileSync(factoryDataPath);
  factoryAddress = PublicKey.fromBase58(
    JSON.parse(factoryData.toString()).address
  );
} else {
  throw Error(`No factory deployment found. Deploy it first`);
}

let factory = new PlotteryFactory(factoryAddress);

let factoryEvents = await factory.fetchEvents();

let deployments;

const deploymentsPath = `./deployV2/${verificationKey.hash.toString()}/deployments.json`;

if (fs.existsSync(deploymentsPath)) {
  let deploymentsBuffer = fs.readFileSync(deploymentsPath);
  deployments = JSON.parse(deploymentsBuffer.toString());
} else {
  deployments = {};
}

// Restore state of factoryManager
for (const event of factoryEvents) {
  let deployEvent = event.event.data as any;

  factoryManager.addDeploy(
    +deployEvent.round,
    deployEvent.randomManager,
    deployEvent.plottery
  );
}

for (let round = +from; round <= +to; round++) {
  let witness = factoryManager.roundsMap.getWitness(Field(round));

  let plotteryPrivateKey = PrivateKey.random();
  let plotteryAddress = plotteryPrivateKey.toPublicKey();

  let randomManagerPrivateKey = PrivateKey.random();
  let randomManagerAddress = randomManagerPrivateKey.toPublicKey();

  let tx = Mina.transaction(deployer, async () => {
    await factory.deployRound(witness, randomManagerAddress, plotteryAddress);
  });

  await tx.prove();
  await tx
    .sign([deployerKey, randomManagerPrivateKey, plotteryPrivateKey])
    .send();

  deployments[round] = {
    randomManager: randomManagerAddress.toBase58(),
    plottery: plotteryAddress.toBase58(),
  };
}

// Write result to file

if (!fs.existsSync(`./deployV2/${verificationKey.hash.toString()}`)) {
  fs.mkdirSync(`./deployV2/${verificationKey.hash.toString()}`, {
    recursive: true,
  });
}

fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
