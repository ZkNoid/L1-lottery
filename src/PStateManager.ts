import {
  AccountUpdate,
  Cache,
  Field,
  JsonProof,
  MerkleMap,
  MerkleMapWitness,
  Mina,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
} from 'o1js';
import { Ticket } from './Ticket.js';
import {
  NumberPacked,
  getEmpty2dMerkleMap,
  comisionTicket,
  getNullifierId,
} from './util.js';
import {
  BLOCK_PER_ROUND,
  TICKET_PRICE,
  mockWinningCombination,
} from './constants.js';
import {
  DistibutionProgram,
  DistributionProof,
  DistributionProofPublicInput,
  addTicket as DPaddTicket,
  init as DPinit,
} from './DistributionProof.js';
// import { dummyBase64Proof } from 'o1js/dist/node/lib/proof-system/zkprogram';
// import { Pickles } from 'o1js/dist/node/snarky';
import { MerkleMap20, MerkleMap20Witness } from './CustomMerkleMap.js';
import { PLottery } from './PLottery.js';
import {
  addTicket as TRaddTicket,
  LotteryAction,
  TicketReduceProgram,
  TicketReduceProof,
  TicketReduceProofPublicInput,
  init as TRinit,
  cutActions,
} from './TicketReduceProof.js';

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

export class PStateManager {
  contract: PLottery;
  ticketMap: MerkleMap20;
  roundTicketMap: MerkleMap20[];
  roundTickets: Ticket[][];
  lastTicketInRound: number[];
  ticketNullifierMap: MerkleMap;
  bankMap: MerkleMap20;
  roundResultMap: MerkleMap20;
  startBlock: Field;
  isMock: boolean;
  dpProofs: { [key: number]: DistributionProof };

  processedTicketData: {
    ticketId: number;
    round: number;
  };

  constructor(plottery: PLottery, startBlock: Field, isMock: boolean = true) {
    this.contract = plottery;
    this.ticketMap = getEmpty2dMerkleMap(20);
    this.roundTicketMap = [new MerkleMap20()];
    this.lastTicketInRound = [1];
    this.roundTickets = [[comisionTicket]];
    this.ticketNullifierMap = new MerkleMap();
    this.bankMap = new MerkleMap20();
    this.roundResultMap = new MerkleMap20();
    this.dpProofs = {};
    this.startBlock = startBlock;
    this.isMock = isMock;
    this.processedTicketData = {
      ticketId: 1,
      round: 0,
    };
  }

  syncWithCurBlock(curBlock: number) {
    let localRound = this.roundTicketMap.length - 1;
    let curRound = Math.ceil((curBlock - +this.startBlock) / BLOCK_PER_ROUND);

    this.startNextRound(curRound - localRound);
  }

  startNextRound(amount: number = 1) {
    for (let i = 0; i < amount; i++) {
      this.roundTicketMap.push(new MerkleMap20());
      this.lastTicketInRound.push(1);
      this.roundTickets.push([comisionTicket]);
    }
  }

  getNextTicketWitenss(
    round: number
  ): [MerkleMap20Witness, MerkleMap20Witness] {
    const roundWitness = this.ticketMap.getWitness(Field.from(round));
    const ticketRoundWitness = this.roundTicketMap[round].getWitness(
      Field.from(this.lastTicketInRound[round])
    );

    return [roundWitness, ticketRoundWitness];
  }

  addTicket(
    ticket: Ticket,
    round: number
  ): [MerkleMap20Witness, MerkleMap20Witness, MerkleMap20Witness, Field] {
    const [roundWitness, ticketRoundWitness] = this.getNextTicketWitenss(round);
    const [bankWitness, bankValue] = this.getBankWitness(round);
    this.roundTicketMap[round].set(
      Field.from(this.lastTicketInRound[round]),
      ticket.hash()
    );
    this.roundTickets[round].push(ticket);
    this.lastTicketInRound[round]++;
    this.ticketMap.set(Field.from(round), this.roundTicketMap[round].getRoot());

    this.bankMap.set(
      Field.from(round),
      bankValue.add(TICKET_PRICE.mul(ticket.amount).value)
    );

    return [roundWitness, ticketRoundWitness, bankWitness, bankValue];
  }

  async reduceTickets(): Promise<TicketReduceProof> {
    const initialState = this.contract.lastProcessedState.get();

    const actionLists = await this.contract.reducer.fetchActions({
      fromActionState: initialState,
    });

    // All this params can be random for init function, because init do not use them
    let input = new TicketReduceProofPublicInput({
      action: new LotteryAction({
        ticket: Ticket.random(this.contract.address),
        round: Field(0),
      }),
      roundWitness: this.ticketMap.getWitness(Field(0)),
      roundTicketWitness: this.roundTicketMap[0].getWitness(Field(0)),
      bankWitness: this.bankMap.getWitness(Field(0)),
      bankValue: Field(0),
    });

    let initialTicketRoot = this.ticketMap.getRoot();
    let initialBankRoot = this.bankMap.getRoot();

    let curProof = this.isMock
      ? await mockProof(
          await TRinit(input, initialState, initialTicketRoot, initialBankRoot),
          TicketReduceProof,
          input
        )
      : await TicketReduceProgram.init(
          input,
          initialState,
          initialTicketRoot,
          initialBankRoot
        );

    for (let actionList of actionLists) {
      for (let action of actionList) {
        if (+action.round != this.processedTicketData.round) {
          this.processedTicketData.round = +action.round;
          this.processedTicketData.ticketId = 1;
        }
        input = new TicketReduceProofPublicInput({
          action: action,
          roundWitness: this.ticketMap.getWitness(action.round),
          roundTicketWitness: this.roundTicketMap[+action.round].getWitness(
            Field(this.processedTicketData.ticketId)
          ),
          bankWitness: this.bankMap.getWitness(action.round),
          bankValue: this.bankMap.get(action.round),
        });

        this.processedTicketData.ticketId++;

        curProof = this.isMock
          ? await mockProof(
              await TRaddTicket(input, curProof),
              TicketReduceProof,
              input
            )
          : await TicketReduceProgram.addTicket(input, curProof);

        this.addTicket(action.ticket, +action.round);
      }

      // Again here we do not need specific input, as it is not using here
      curProof = this.isMock
        ? await mockProof(
            await cutActions(input, curProof),
            TicketReduceProof,
            input
          )
        : await TicketReduceProgram.cutActions(input, curProof);
    }

    return curProof;
  }

  // Returns witness and value
  getBankWitness(round: number): [MerkleMap20Witness, Field] {
    const bankWitness = this.bankMap.getWitness(Field.from(round));
    const value = this.bankMap.get(Field.from(round));

    return [bankWitness, value];
  }

  updateResult(round: number): MerkleMap20Witness {
    const witness = this.roundResultMap.getWitness(Field.from(round));
    const packedNumbers = NumberPacked.pack(
      mockWinningCombination.map((val) => UInt32.from(val))
    );
    this.roundResultMap.set(Field.from(round), packedNumbers);

    return witness;
  }

  async getDP(round: number): Promise<DistributionProof> {
    if (this.dpProofs[round]) {
      return this.dpProofs[round];
    }

    const winningCombination = this.roundResultMap.get(Field.from(round));
    let ticketsInRound = this.lastTicketInRound[round];
    let curMap = new MerkleMap20();

    let input = new DistributionProofPublicInput({
      winningCombination,
      ticket: Ticket.random(PublicKey.empty()),
      valueWitness: this.roundTicketMap[round].getWitness(Field(0)),
    });

    let curProof = this.isMock
      ? await mockProof(await DPinit(input), DistributionProof, input)
      : await DistibutionProgram.init(input);

    for (let i = 1; i < ticketsInRound; i++) {
      const ticket = this.roundTickets[round][i];

      const input = new DistributionProofPublicInput({
        winningCombination,
        ticket: ticket,
        valueWitness: curMap.getWitness(Field(i)),
      });
      curMap.set(Field(i), ticket.hash());

      if (this.isMock) {
        curProof = await mockProof(
          await DPaddTicket(input, curProof),
          DistributionProof,
          input
        );
      } else {
        curProof = await DistibutionProgram.addTicket(input, curProof);
      }
      // curProof = await DistibutionProgram.addTicket(input, curProof);
    }

    this.dpProofs[round] = curProof;
    return curProof;
  }

  // Changes value of nullifier!
  async getReward(
    round: number,
    ticket: Ticket,
    roundDP: JsonProof | undefined = undefined
  ): Promise<{
    roundWitness: MerkleMap20Witness;
    roundTicketWitness: MerkleMap20Witness;
    dp: DistributionProof;
    winningNumbers: Field;
    resultWitness: MerkleMap20Witness;
    bankValue: Field;
    bankWitness: MerkleMap20Witness;
    nullifierWitness: MerkleMapWitness;
  }> {
    const roundWitness = this.ticketMap.getWitness(Field.from(round));

    const ticketHash = ticket.hash();
    let roundTicketWitness;
    // Find ticket in tree
    let ticketId = 0;
    for (; ticketId < this.lastTicketInRound[round]; ticketId++) {
      if (
        this.roundTicketMap[round]
          .get(Field(ticketId))
          .equals(ticketHash)
          .toBoolean()
      ) {
        roundTicketWitness = this.roundTicketMap[round].getWitness(
          Field.from(ticketId)
        );
        break;
      }
    }
    if (!roundTicketWitness) {
      throw Error(`No such ticket in round ${round}`);
    }

    const dp = !roundDP
      ? await this.getDP(round)
      : await DistributionProof.fromJSON(roundDP);
    const winningNumbers = this.roundResultMap.get(Field.from(round));
    if (winningNumbers.equals(Field(0)).toBoolean()) {
      throw Error('Do not have a result for this round');
    }
    const resultWitness = this.roundResultMap.getWitness(Field.from(round));

    const bankValue = this.bankMap.get(Field.from(round));
    const bankWitness = this.bankMap.getWitness(Field.from(round));

    const nullifierWitness = this.ticketNullifierMap.getWitness(
      getNullifierId(Field.from(round), Field.from(ticketId))
    );

    this.ticketNullifierMap.set(
      getNullifierId(Field.from(round), Field.from(ticketId)),
      Field(1)
    );

    return {
      roundWitness,
      roundTicketWitness,
      dp,
      winningNumbers,
      resultWitness,
      bankValue,
      bankWitness,
      nullifierWitness,
    };
  }

  async getCommision(round: number): Promise<{
    roundWitness: MerkleMap20Witness;
    dp: DistributionProof;
    winningNumbers: Field;
    resultWitness: MerkleMap20Witness;
    bankValue: Field;
    bankWitness: MerkleMap20Witness;
    nullifierWitness: MerkleMapWitness;
  }> {
    const roundWitness = this.ticketMap.getWitness(Field.from(round));

    const dp = await this.getDP(round);
    const winningNumbers = this.roundResultMap.get(Field.from(round));
    if (winningNumbers.equals(Field(0)).toBoolean()) {
      throw Error('Do not have a result for this round');
    }
    const resultWitness = this.roundResultMap.getWitness(Field.from(round));

    const bankValue = this.bankMap.get(Field.from(round));
    const bankWitness = this.bankMap.getWitness(Field.from(round));

    const nullifierWitness = this.ticketNullifierMap.getWitness(
      getNullifierId(Field.from(round), Field.from(0))
    );

    this.ticketNullifierMap.set(
      getNullifierId(Field.from(round), Field.from(0)),
      Field(1)
    );

    return {
      roundWitness,
      dp,
      winningNumbers,
      resultWitness,
      bankValue,
      bankWitness,
      nullifierWitness,
    };
  }

  async getRefund(
    round: number,
    ticket: Ticket
  ): Promise<{
    roundWitness: MerkleMap20Witness;
    roundTicketWitness: MerkleMap20Witness;
    resultWitness: MerkleMap20Witness;
    bankValue: Field;
    bankWitness: MerkleMap20Witness;
    nullifierWitness: MerkleMapWitness;
  }> {
    const roundWitness = this.ticketMap.getWitness(Field.from(round));

    const ticketHash = ticket.hash();
    let roundTicketWitness;
    // Find ticket in tree
    let ticketId = 0;
    for (; ticketId < this.lastTicketInRound[round]; ticketId++) {
      if (
        this.roundTicketMap[round]
          .get(Field(ticketId))
          .equals(ticketHash)
          .toBoolean()
      ) {
        roundTicketWitness = this.roundTicketMap[round].getWitness(
          Field.from(ticketId)
        );
        break;
      }
    }
    if (!roundTicketWitness) {
      throw Error(`No such ticket in round ${round}`);
    }

    const resultWitness = this.roundResultMap.getWitness(Field.from(round));

    const bankValue = this.bankMap.get(Field.from(round));
    const bankWitness = this.bankMap.getWitness(Field.from(round));

    const nullifierWitness = this.ticketNullifierMap.getWitness(
      getNullifierId(Field.from(round), Field.from(ticketId))
    );

    this.ticketNullifierMap.set(
      getNullifierId(Field.from(round), Field.from(ticketId)),
      Field(1)
    );

    this.bankMap.set(
      Field.from(round),
      bankValue.sub(ticket.amount.mul(TICKET_PRICE).value)
    );

    return {
      roundWitness,
      roundTicketWitness,
      resultWitness,
      bankValue,
      bankWitness,
      nullifierWitness,
    };
  }
}
