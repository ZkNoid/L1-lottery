import dotenv from 'dotenv';
dotenv.config();

import mongoose, { model, Model, Schema } from 'mongoose';

export interface IRoundData extends Document {
  code: string;
  roundId: number;
  tickets: {
    amount: number;
    numbers: number[];
    owner: string;
  }[];
  used: boolean;
}

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

const RoundsDataSchema = new Schema<IRoundData>(
  {
    code: { type: String, required: true },
    roundId: { type: Number, required: true },
    tickets: {
      amount: { type: Number, required: true },
      numbers: { type: [Number], required: true },
      owner: { type: String, required: true },
    },
    used: { type: Boolean },
  },
  {
    collection: 'gift-codes',
  }
);

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
    processingStarted: { type: Boolean },
    updatedAt: { type: Date, default: Date.now },
    buyTxHash: { type: String },
    processed: { type: Boolean, default: false },
    failed: { type: Boolean, default: false },
    reason: { type: String },
  },
  {
    collection: 'promo_tickets_queue',
  }
);

// Create a Model.
export const PromoQueueDataModel = model<IPromoQueueData>(
  'promo_tickets_queue',
  PromoQueueDataSchema
);

export const RoundDataModel = model<IRoundData>('rounds', RoundsDataSchema);

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MongoDB URI not specified in environment variables.');
  process.exit(1);
}

mongoose.set('debug', true);
await mongoose.connect(mongoUri, { w: 1 });
console.log('Connected to MongoDB');

const allTickets = await PromoQueueDataModel.find({});

console.log(`All tickets length ${allTickets.length}`);

const allProcessing = await PromoQueueDataModel.find({
  processingStarted: true,
});

console.log(`Found: ${allProcessing.length} tickets`);

for (const request of allProcessing) {
  let res = await RoundDataModel.updateOne(
    {
      _id: request._id,
    },
    {
      $set: {
        processingStarted: false,
      },
    },
    {
      upsert: true,
    }
  ).exec();

  console.log(res);

  await RoundDataModel.updateOne(
    {
      code: request.giftCode,
    },
    {
      $set: {
        used: false,
      },
    },
    {
      upsert: true,
    }
  ).exec();

  //   const foundTicket = await RoundDataModel.find(
  //     {
  //       'tickets.owner': request.userAddress,
  //       'tickets.numbers': { $all: request.ticket.numbers },
  //     },
  //     {
  //       tickets: {
  //         $elemMatch: {
  //           owner: request.userAddress,
  //           numbers: { $all: request.ticket.numbers },
  //         },
  //       },
  //     }
  //   );

  //   if (foundTicket.length == 0) {
  //     console.log(`${request.userAddress} ${request.giftCode}`);
  //   } else {
  //     console.log(`${request.userAddress}`);
  //   }

  //   console.log(foundTicket);
}

console.log('end');
await mongoose.disconnect();
