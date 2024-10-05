import {
  AccountUpdate,
  Bool,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Poseidon,
  PublicKey,
  SmartContract,
  State,
  state,
  Struct,
  UInt64,
  Permissions,
  method,
  Cache,
} from 'o1js';
import { BLOCK_PER_ROUND } from './constants';
import { MerkleMap20 } from './Structs/CustomMerkleMap';
import { RandomManager } from './Random/RandomManager';
import { PLottery } from './PLottery';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
import { TicketReduceProgram } from './Proofs/TicketReduceProof';
import { DistributionProgram } from './Proofs/DistributionProof';

const emptyMerkleMapRoot = new MerkleMap().getRoot();

await ZkonZkProgram.compile({ cache: Cache.FileSystem('cache') });
await ZkonRequestCoordinator.compile({ cache: Cache.FileSystem('cache') });
const { verificationKey: randomManagerVK } = await RandomManager.compile({
  cache: Cache.FileSystem('cache'),
});
// const { verificationKey: mockedRandomManagerVK } =
//   await MockedRandomManager.compile();
await TicketReduceProgram.compile({ cache: Cache.FileSystem('cache') });
await DistributionProgram.compile({ cache: Cache.FileSystem('cache') });
const { verificationKey: PLotteryVK } = await PLottery.compile({
  cache: Cache.FileSystem('cache'),
});

class RoundInfo extends Struct({
  startSlot: Field,
  randomManagerAddress: PublicKey,
}) {}

export class DeployEvent extends Struct({
  round: Field,
  randomManager: PublicKey,
  plottery: PublicKey,
}) {}

const startSlot = Field(0);

export class PlotteryFactory extends SmartContract {
  events = {
    'deploy-plottery': DeployEvent,
  };

  @state(Field) roundsRoot = State<Field>();

  init() {
    super.init();
    this.roundsRoot.set(emptyMerkleMapRoot);
  }

  @method
  async deployRound(
    witness: MerkleMapWitness,
    randomManager: PublicKey,
    plottery: PublicKey
  ) {
    // Check if round was not used and update merkle map
    const curRoot = this.roundsRoot.getAndRequireEquals();
    const [expectedRoot, round] = witness.computeRootAndKeyV2(Field(0));
    curRoot.assertEquals(expectedRoot, 'Wrong witness');

    const [newRoot] = witness.computeRootAndKeyV2(Field(1));
    this.roundsRoot.set(newRoot);

    // Deploy and initialize random manager
    {
      const rmUpdate = AccountUpdate.createSigned(randomManager);
      rmUpdate.account.verificationKey.set(randomManagerVK);
      rmUpdate.update.appState[0] = {
        isSome: Bool(true),
        value: startSlot,
      };

      // Update permissions
      rmUpdate.body.update.permissions = {
        isSome: Bool(true),
        value: {
          ...Permissions.default(),
        },
      };
    }
    // Deploy plottery
    {
      const plotteryUpdate = AccountUpdate.createSigned(plottery);
      plotteryUpdate.account.verificationKey.set(PLotteryVK);
      // Start slot set
      plotteryUpdate.update.appState[0] = {
        isSome: Bool(true),
        value: startSlot,
      };
      // Set random manager
      plotteryUpdate.update.appState[1] = {
        isSome: Bool(true),
        value: randomManager.x, // ?
      };

      // Set ticket ticketRoot
      plotteryUpdate.update.appState[2] = {
        isSome: Bool(true),
        value: new MerkleMap20().getRoot(),
      };

      // Set ticket nullifier
      plotteryUpdate.update.appState[3] = {
        isSome: Bool(true),
        value: new MerkleMap20().getRoot(),
      };

      // Update permissions
      plotteryUpdate.body.update.permissions = {
        isSome: Bool(true),
        value: {
          ...Permissions.default(),
        },
      };
    }

    // Emit event
    this.emitEvent(
      'deploy-plottery',
      new DeployEvent({ round, plottery, randomManager })
    );
  }
}
