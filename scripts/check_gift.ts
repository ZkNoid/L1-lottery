import dotenv from 'dotenv';
dotenv.config();

import mongoose, { model, Model, Schema } from 'mongoose';

export interface IPromoQueueData extends Document {
  userAddress: string;
  giftCode: string;
  roundId: number;
  ticket: {
    numbers: number[];
  };
  createdAt: Date;
  signature: string;
  processingStarted: boolean;
  updatedAt: Date;
  buyTxHash: string;
  processed: boolean;
  failed?: boolean;
  reason?: string;
}

// Create a Schema corresponding to the document interface.
const PromoQueueDataSchema = new Schema<IPromoQueueData>(
  {
    userAddress: { type: String, required: true },
    giftCode: { type: String, required: true },
    roundId: { type: Number, required: true },
    ticket: {
      numbers: { type: [Number], required: true },
    },
    createdAt: { type: Date, default: Date.now },
    signature: { type: String, required: true },
    processingStarted: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now },
    buyTxHash: { type: String },
    processed: { type: Boolean, default: false },
    failed: { type: Boolean, default: false },
    reason: { type: String },
  },
  {
    timestamps: true, // Automatically manage createdAt and updatedAt
  }
);

// Create a Model.
export const PromoQueueDataModel = model<IPromoQueueData>(
  'promo_tickets_queue',
  PromoQueueDataSchema
);

async function findTwoDuplicateProcessedRecords(
  promoQueueData: Model<IPromoQueueData>
): Promise<IPromoQueueData[]> {
  const duplicateGroup = await promoQueueData.aggregate([
    { $match: { processed: true } },
    {
      $group: {
        _id: '$giftCode',
        count: { $sum: 1 },
        records: { $push: '$$ROOT' },
      },
    },
    { $match: { count: { $gte: 2 } } },
    { $limit: 1 }, // Only need one group that has at least two records
  ]);

  if (duplicateGroup.length === 0) {
    return []; // No duplicates found
  }

  // Extract the first two records from the found group
  const records: IPromoQueueData[] = duplicateGroup[0].records.slice(0, 2);
  return records;
}

async function findUniqueFailedRecords(
  promoQueueData: Model<IPromoQueueData>
): Promise<IPromoQueueData[]> {
  const uniqueFailedGroup = await promoQueueData.aggregate([
    { $match: { failed: true } },
    {
      $group: {
        _id: '$giftCode',
        record: { $first: '$$ROOT' },
      },
    },
  ]);

  // Extract the record from each group result
  const uniqueFailedRecords = uniqueFailedGroup.map(
    (group: any) => group.record
  );
  return uniqueFailedRecords;
}

async function findFailedUniqueGiftCodeRecords(
  promoQueueData: Model<IPromoQueueData>
): Promise<IPromoQueueData[]> {
  const uniqueFailedGroup = await promoQueueData.aggregate([
    // Step 1: Match only documents where failed is true
    { $match: { failed: true } },
    // Step 2: Group by giftCode and count the occurrences
    {
      $group: {
        _id: '$giftCode',
        count: { $sum: 1 },
        record: { $first: '$$ROOT' },
      },
    },
    // Step 3: Only keep groups where the giftCode appears exactly once
    { $match: { count: 1 } },
  ]);

  // Extract the single record from each group result
  const uniqueFailedRecords = uniqueFailedGroup.map(
    (group: any) => group.record
  );
  return uniqueFailedRecords;
}

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MongoDB URI not specified in environment variables.');
  process.exit(1);
}

await mongoose.connect(mongoUri);
console.log('Connected to MongoDB');

// 1
const twoDuplicates = await findTwoDuplicateProcessedRecords(
  PromoQueueDataModel
);
console.log('Two duplicate processed records:', twoDuplicates);

// 2
const uniqueFailedRecords = await findFailedUniqueGiftCodeRecords(
  PromoQueueDataModel
);
console.log('Unique failed records:', uniqueFailedRecords);
