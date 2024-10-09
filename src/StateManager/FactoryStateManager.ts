import { Field, MerkleMap, PublicKey } from 'o1js';
import { PStateManager } from './PStateManager.js';
import { PLottery } from '../PLottery.js';
import { RandomManagerManager } from './RandomManagerManager.js';

interface IDeployInfo {
  round: number;
  randomManager: PublicKey;
  plottery: PublicKey;
}

export class FactoryManager {
  roundsMap: MerkleMap;
  deploys: { [key: number]: IDeployInfo };
  plotteryManagers: { [round: number]: PStateManager };
  randomManagers: { [round: number]: RandomManagerManager };
  isMock: boolean;
  shouldUpdateState: boolean;

  constructor(isMock: boolean = true, shouldUpdateState: boolean = false) {
    this.roundsMap = new MerkleMap();
    this.deploys = {};
    this.plotteryManagers = {};
    this.randomManagers = {};
    this.isMock = isMock;
    this.shouldUpdateState = shouldUpdateState;
  }

  addDeploy(round: number, randomManager: PublicKey, plottery: PublicKey) {
    if (this.deploys[round]) {
      throw Error(`Round ${round} already deployed`);
    }

    this.deploys[round] = { round, randomManager, plottery };
    this.roundsMap.set(Field(round), Field(1));

    const plotteryContract = new PLottery(plottery);

    this.plotteryManagers[round] = new PStateManager(
      plotteryContract,
      this.isMock,
      this.shouldUpdateState
    );
    this.randomManagers[round] = new RandomManagerManager();
  }
}
