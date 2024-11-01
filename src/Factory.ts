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
  UInt32,
} from 'o1js';
import { vkJSON } from '../vk.js';
import { BLOCK_PER_ROUND } from './constants.js';
import { MerkleMap20 } from './Structs/CustomMerkleMap.js';
import { RandomManager } from './Random/RandomManager.js';
import { PLottery } from './PLottery.js';
import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
import { TicketReduceProgram } from './Proofs/TicketReduceProof.js';
import { DistributionProgram } from './Proofs/DistributionProof.js';
import { getIPFSCID } from './util.js';

const emptyMerkleMapRoot = new MerkleMap().getRoot();

// await ZkonZkProgram.compile({ cache: Cache.FileSystem('cache') });
// await ZkonRequestCoordinator.compile({ cache: Cache.FileSystem('cache') });
// const { verificationKey: randomManagerVK } = await RandomManager.compile();
// await TicketReduceProgram.compile({ cache: Cache.FileSystem('cache') });
// await DistributionProgram.compile({ cache: Cache.FileSystem('cache') });
// const { verificationKey: PLotteryVK } = await PLottery.compile({
//   cache: Cache.FileSystem('cache'),
// });

const { hashPart1, hashPart2 } = getIPFSCID();

const randomManagerVK = {
  hash: Field(vkJSON.randomManagerVK.hash),
  data: vkJSON.randomManagerVK.data,
};

const PLotteryVK = {
  hash: Field(vkJSON.PLotteryVK.hash),
  data: vkJSON.PLotteryVK.data,
};

class RoundInfo extends Struct({
  startSlot: Field,
  randomManagerAddress: PublicKey,
}) {}

export class DeployEvent extends Struct({
  round: Field,
  randomManager: PublicKey,
  plottery: PublicKey,
}) {}

///Just copy with other vk for random manager
export class PlotteryFactory extends SmartContract {
  events = {
    'deploy-plottery': DeployEvent,
  };

  @state(Field) roundsRoot = State<Field>();
  @state(UInt32) startSlot = State<UInt32>();

  init() {
    super.init();
    this.roundsRoot.set(emptyMerkleMapRoot);
    this.network.globalSlotSinceGenesis.requireNothing();
    this.startSlot.set(this.network.globalSlotSinceGenesis.get());
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

    const startSlot = this.startSlot.getAndRequireEquals();
    const localStartSlot = startSlot.value.add(round.mul(BLOCK_PER_ROUND));

    // Deploy and initialize random manager
    {
      const rmUpdate = AccountUpdate.createSigned(randomManager);
      rmUpdate.account.verificationKey.set(randomManagerVK);
      rmUpdate.update.appState[0] = {
        isSome: Bool(true),
        value: localStartSlot,
      };

      // Update permissions
      rmUpdate.body.update.permissions = {
        isSome: Bool(true),
        value: {
          ...Permissions.default(),
        },
      };

      rmUpdate.body.update.appState[4] = {
        isSome: Bool(true),
        value: hashPart1,
      };

      rmUpdate.body.update.appState[5] = {
        isSome: Bool(true),
        value: hashPart2,
      };
    }
    // Deploy plottery
    {
      const plotteryUpdate = AccountUpdate.createSigned(plottery);
      plotteryUpdate.account.verificationKey.set(PLotteryVK);

      // Set random manager
      const rmFields = randomManager.toFields();

      // Random manager address
      plotteryUpdate.update.appState[0] = {
        isSome: Bool(true),
        value: rmFields[0],
      };

      plotteryUpdate.update.appState[1] = {
        isSome: Bool(true),
        value: rmFields[1],
      };

      // Start slot set
      plotteryUpdate.update.appState[2] = {
        isSome: Bool(true),
        value: localStartSlot,
      };

      // Set ticket ticketRoot
      plotteryUpdate.update.appState[3] = {
        isSome: Bool(true),
        value: new MerkleMap20().getRoot(),
      };

      // Set ticket nullifier
      plotteryUpdate.update.appState[4] = {
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
