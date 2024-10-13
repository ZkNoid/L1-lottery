import { AccountUpdate, Field, Mina, PrivateKey, PublicKey } from 'o1js';
import { DeployEvent, PlotteryFactory } from '../src/Factory.js';
import { FactoryManager } from '../src/StateManager/FactoryStateManager.js';
import { configDefaultInstance, getFedFactoryManager } from './utils.js';
import * as fs from 'fs';

let { transactionFee } = configDefaultInstance();

let deployerKey = PrivateKey.fromBase58(process.env.DEPLOYER_KEY!);
let deployer = deployerKey.toPublicKey();

console.log(`Using deployer ${deployer.toBase58()}`);

let from = process.argv[2];

let to = process.argv[3];

if (!from || !to) {
  throw Error(`You should provide from round and to round`);
}

console.log(`Compiling PlotteryFactory`);

const networkId = Mina.activeInstance.getNetworkId().toString();

let { verificationKey } = await PlotteryFactory.compile();

console.log(`Factory verification key: ${verificationKey.hash.toString()}`);

let factoryAddress: PublicKey;

if (
  !fs.existsSync(`./deployV2/${networkId}/${verificationKey.hash.toString()}`)
) {
  throw Error(`No factory deployment found. Deploy it first`);
}

const factoryDataPath = `./deployV2/${networkId}/${verificationKey.hash.toString()}/factory.json`;
if (fs.existsSync(factoryDataPath)) {
  let factoryData = fs.readFileSync(factoryDataPath);
  factoryAddress = PublicKey.fromBase58(
    JSON.parse(factoryData.toString()).address
  );
} else {
  throw Error(`No factory deployment found. Deploy it first`);
}

let factory = new PlotteryFactory(factoryAddress);

let deployments;

const deploymentsPath = `./deployV2/${networkId}/${verificationKey.hash.toString()}/deployments.json`;

if (fs.existsSync(deploymentsPath)) {
  let deploymentsBuffer = fs.readFileSync(deploymentsPath);
  deployments = JSON.parse(deploymentsBuffer.toString());
} else {
  deployments = {};
}

const factoryManager = await getFedFactoryManager(factory);

for (let round = +from; round <= +to; round++) {
  if (factoryManager.roundsMap.get(Field(round)).greaterThan(0).toBoolean()) {
    console.log(`Plottery for round ${round} have been deployed`);
    continue;
  }
  let witness = factoryManager.roundsMap.getWitness(Field(round));

  let plotteryPrivateKey = PrivateKey.random();
  let plotteryAddress = plotteryPrivateKey.toPublicKey();

  let randomManagerPrivateKey = PrivateKey.random();
  let randomManagerAddress = randomManagerPrivateKey.toPublicKey();

  console.log(
    `Deploying plottery: ${plotteryAddress.toBase58()} and random manager: ${randomManagerAddress.toBase58()} for round ${round}`
  );
  let tx = await Mina.transaction(
    { sender: deployer, fee: 10 * transactionFee },
    async () => {
      AccountUpdate.fundNewAccount(deployer);
      AccountUpdate.fundNewAccount(deployer);

      await factory.deployRound(witness, randomManagerAddress, plotteryAddress);
    }
  );

  await tx.prove();
  let txInfo = await tx
    .sign([deployerKey, randomManagerPrivateKey, plotteryPrivateKey])
    .send();

  const txResult = await txInfo.safeWait();

  if (txResult.status === 'rejected') {
    console.log(`Transaction failed due to following reason`);
    console.log(txResult.errors);
    break;
  }

  factoryManager.addDeploy(round, randomManagerAddress, plotteryAddress);
  deployments[round] = {
    randomManager: randomManagerAddress.toBase58(),
    plottery: plotteryAddress.toBase58(),
  };
}

// Write result to file

if (
  !fs.existsSync(`./deployV2/${networkId}/${verificationKey.hash.toString()}`)
) {
  fs.mkdirSync(`./deployV2/${networkId}/${verificationKey.hash.toString()}`, {
    recursive: true,
  });
}

fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
