import { Field, JsonProof, MerkleMap, MerkleMapWitness, PublicKey } from 'o1js';
import { Ticket } from '../Structs/Ticket.js';
import {
  BLOCK_PER_ROUND,
  COMMISSION,
  PRECISION,
  TICKET_PRICE,
  mockWinningCombination,
} from '../constants.js';
import {
  DistributionProgram,
  DistributionProof,
  DistributionProofPublicInput,
  addTicket,
  init,
} from '../Proofs/DistributionProof.js';
// import { dummyBase64Proof } from 'o1js/dist/node/lib/proof-system/zkprogram';
// import { Pickles } from 'o1js/dist/node/snarky';
import { MerkleMap20, MerkleMap20Witness } from '../Structs/CustomMerkleMap.js';
import { PLottery } from '../PLottery.js';

export async function mockProof<I, O, P>(
  publicOutput: O,
  ProofType: new ({
    proof,
    publicInput,
    publicOutput,
    maxProofsVerified,
  }: {
    proof: unknown;
    publicInput: I;
    publicOutput: any;
    maxProofsVerified: 0 | 2 | 1;
  }) => P,
  publicInput: I
): Promise<P> {
  // const [, proof] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
  return new ProofType({
    proof: null as any,
    maxProofsVerified: 2,
    publicInput,
    publicOutput,
  });
}

export class BaseStateManager {
  contract: PLottery;
  ticketMap: MerkleMap20;
  roundTickets: (Ticket | undefined)[]; // Refunded ticket will be undefined
  lastTicketInRound: number;
  ticketNullifierMap: MerkleMap20;
  startSlot: Field;
  isMock: boolean;
  shouldUpdateState: boolean;
  dpProof: DistributionProof | undefined;

  constructor(
    contract: PLottery,
    isMock: boolean = true,
    shouldUpdateState: boolean = false
  ) {
    this.contract = contract;
    this.ticketMap = new MerkleMap20();
    this.lastTicketInRound = 0;
    this.roundTickets = [];
    this.ticketNullifierMap = new MerkleMap20();
    this.isMock = isMock;
    this.shouldUpdateState = shouldUpdateState;
  }

  addTicket(ticket: Ticket) {
    throw Error('Add ticket is not implemented');
  }

  async getDP(round: number): Promise<DistributionProof> {
    if (this.dpProof) {
      return this.dpProof;
    }

    const reducedTickets = (await this.contract.reducer.fetchActions()).flat(1);

    const winningCombination = this.contract.result.get();
    let curMap = new MerkleMap20();

    let input = new DistributionProofPublicInput({
      winningCombination,
      ticket: Ticket.random(PublicKey.empty()),
      valueWitness: this.ticketMap.getWitness(Field(0)),
    });

    let curProof = this.isMock
      ? await mockProof(await init(input), DistributionProof, input)
      : await DistributionProgram.init(input);

    for (let i = 0; i < reducedTickets.length; i++) {
      const ticket = reducedTickets[i].ticket;
      if (!ticket) {
        // Skip refunded tickets
        continue;
      }

      const input = new DistributionProofPublicInput({
        winningCombination,
        ticket: ticket,
        valueWitness: curMap.getWitness(Field(i)),
      });
      curMap.set(Field(i), ticket.hash());

      if (this.isMock) {
        curProof = await mockProof(
          await addTicket(input, curProof),
          DistributionProof,
          input
        );
      } else {
        curProof = await DistributionProgram.addTicket(input, curProof);
      }
    }

    this.dpProof = curProof;
    return curProof;
  }

  // Changes value of nullifier!
  async getReward(
    round: number,
    ticket: Ticket,
    roundDP: JsonProof | undefined = undefined,
    ticketIndex: number = 1 // If two or more same tickets presented
  ): Promise<{
    ticketWitness: MerkleMap20Witness;
    dp: DistributionProof;
    nullifierWitness: MerkleMap20Witness;
  }> {
    const ticketHash = ticket.hash();
    let ticketWitness;
    // Find ticket in tree
    let ticketId = 0;
    for (; ticketId < this.lastTicketInRound; ticketId++) {
      if (this.ticketMap.get(Field(ticketId)).equals(ticketHash).toBoolean()) {
        ticketIndex--;
        if (ticketIndex == 0) {
          ticketWitness = this.ticketMap.getWitness(Field.from(ticketId));
          break;
        }
      }
    }
    if (!ticketWitness) {
      throw Error(`No such ticket in round ${round}`);
    }

    const dp = !roundDP
      ? await this.getDP(round)
      : await DistributionProof.fromJSON(roundDP);

    const nullifierWitness = this.ticketNullifierMap.getWitness(
      Field.from(ticketId)
    );

    if (this.shouldUpdateState) {
      this.ticketNullifierMap.set(Field.from(ticketId), Field(1));
    }

    return {
      ticketWitness,
      dp,
      nullifierWitness,
    };
  }

  async getRefund(
    round: number,
    ticket: Ticket
  ): Promise<{
    ticketWitness: MerkleMap20Witness;
  }> {
    const ticketHash = ticket.hash();
    let ticketWitness;
    // Find ticket in tree
    let ticketId = 0;
    for (; ticketId < this.lastTicketInRound; ticketId++) {
      if (this.ticketMap.get(Field(ticketId)).equals(ticketHash).toBoolean()) {
        ticketWitness = this.ticketMap.getWitness(Field.from(ticketId));
        break;
      }
    }
    if (!ticketWitness) {
      throw Error(`No such ticket in round ${round}`);
    }

    if (this.shouldUpdateState) {
      console.log('Update state');
      this.ticketMap.set(Field(ticketId), Field(0));

      this.roundTickets[ticketId] = undefined;
    }

    return {
      ticketWitness,
    };
  }
}
