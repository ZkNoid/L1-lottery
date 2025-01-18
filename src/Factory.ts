import {
  AccountUpdate,
  Bool,
  Field,
  MerkleMap,
  MerkleMapWitness,
  PublicKey,
  SmartContract,
  State,
  state,
  Struct,
  Permissions,
  method,
  UInt32,
} from 'o1js';
import { vkJSON } from '../vk.js';
import { BLOCK_PER_ROUND } from './constants.js';
import { MerkleMap20 } from './Structs/CustomMerkleMap.js';
import { NetworkIds } from './Network.js';

const emptyMerkleMapRoot = new MerkleMap().getRoot();
const networkId = process.env.NETWORK_ID || NetworkIds.MINA_DEVNET;

const vk = (vkJSON as any)[networkId];

const randomManagerVK = {
  hash: Field(vk.randomManagerVK.hash),
  data: vk.randomManagerVK.data,
};

const PLotteryVK = {
  hash: Field(vk.PLotteryVK.hash),
  data: vk.PLotteryVK.data,
};

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
    // this.startSlot.set(UInt32.from(672239)); // "Wed Jan 15 2025 12:00:00 GMT+0000"
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
