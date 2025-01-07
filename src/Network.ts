import { arch } from 'os';

export interface Network {
  networkID: string;
  isMainnet: boolean;
  graphql: string;
  archive: string;
}

export const NETWORKS: { [key: string]: Network } = {
  mainnet: {
    networkID: 'mina:mainnet',
    isMainnet: true,
    graphql: 'https://api.minascan.io/node/mainnet/v1/graphql',
    archive: 'https://api.minascan.io/archive/mainnet/v1/graphql',
  },
  testnet: {
    networkID: 'mina:testnet',
    isMainnet: false,
    graphql: 'https://api.minascan.io/node/devnet/v1/graphql',
    archive: 'https://api.minascan.io/archive/devnet/v1/graphql',
  },
};

export const NetworkIds = {
  MINA_DEVNET: 'mina:testnet',
  MINA_MAINNET: 'mina:mainnet',
};
