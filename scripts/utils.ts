import dotenv from 'dotenv';
dotenv.config();
import { Mina } from 'o1js';
import { FactoryManager } from '../src/StateManager/FactoryStateManager.js';
import { PlotteryFactory } from '../src/Factory.js';
import { Network, NETWORKS } from '../src/constants/networks.js';

export const configDefaultInstance = (): { transactionFee: number, network: Network } => {
  const transactionFee = 100_000_000;
  const network_ = NETWORKS[process.env.NETWORK_ID!];

  const network = Mina.Network({
    networkId: network_.isMainnet ? 'mainnet' : 'testnet',
    mina: network_.graphql,
    lightnetAccountManager: network_.lightnetAccountManager,
    archive: network_.archive,
  });
  
  Mina.setActiveInstance(network);

  return { transactionFee, network: network_ };
};

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
