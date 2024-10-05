import { Field, MerkleMap, PublicKey } from 'o1js';
import { PStateManager } from './PStateManager';
import { PLottery } from '../PLottery';
import { RandomManagerManager } from './RandomManagerManager';

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

  constructor() {
    this.roundsMap = new MerkleMap();
    this.deploys = {};
    this.plotteryManagers = {};
    this.randomManagers = {};
  }

  addDeploy(round: number, randomManager: PublicKey, plottery: PublicKey) {
    if (this.deploys[round]) {
      throw Error(`Round ${round} already deployed`);
    }

    this.deploys[round] = { round, randomManager, plottery };
    this.roundsMap.set(Field(round), Field(1));

    const plotteryContract = new PLottery(plottery);

    this.plotteryManagers[round] = new PStateManager(plotteryContract);
    this.randomManagers[round] = new RandomManagerManager();
  }
}
