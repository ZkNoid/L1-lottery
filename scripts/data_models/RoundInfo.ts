import mongoose, { Document, Schema, Types } from 'mongoose';

interface Proof {
  publicInput: string[];
  publicOutput: string[];
  maxProofsVerified: 0 | 1 | 2;
  proof: string;
}

export interface RoundTickets {
  amount: number;
  numbers: number[];
  owner: string;
}

export interface RoundsData extends Document {
  roundId: number;
  bank: mongoose.Types.Decimal128; // Using Decimal128 for large integers
  tickets: RoundTickets[];
  winningCombination: number[] | null;
  total: number;
  plotteryAddress: string;
  randomManagerAddress: string;
  lastReducedTicket: number;
  reduceProof: Proof;
  createdAt?: Date;
  updatedAt?: Date;
}

const ProofSchema = new Schema<Proof>(
  {
    publicInput: { type: [String], required: true },
    publicOutput: { type: [String], required: true },
    maxProofsVerified: { type: Number, enum: [0, 1, 2], required: true },
    proof: { type: String, required: true },
  },
  { _id: false } // No separate _id for subdocument
);

const RoundTicketsSchema = new Schema<RoundTickets>(
  {
    amount: { type: Number, required: true },
    numbers: { type: [Number], required: true },
    owner: { type: String, required: true },
  },
  { _id: false } // No separate _id for subdocument
);

const RoundsDataSchema = new Schema<RoundsData>(
  {
    roundId: { type: Number, required: true },
    bank: { type: Schema.Types.Decimal128, required: true }, // Use appropriate type or plugin for bigint if needed
    tickets: { type: [RoundTicketsSchema], required: true },
    winningCombination: { type: [Number], default: null },
    total: { type: Number, required: true },
    plotteryAddress: { type: String, required: true },
    randomManagerAddress: { type: String, required: true },
    lastReducedTicket: { type: Number, required: true },
    reduceProof: { type: ProofSchema, required: true },
  },
  {
    timestamps: true, // Automatically add createdAt and updatedAt
    collection: 'rounds', // Specify collection name
  }
);

export const RoundsDataModel = mongoose.model<RoundsData>(
  'rounds',
  RoundsDataSchema
);
