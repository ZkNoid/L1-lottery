import mongoose, { Schema, Document, Model } from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

/**
 * 1. Define a plain TypeScript interface representing the data structure.
 */
interface IGiftCode {
  userAddress: string;
  transactionHash: string;
  code: string;
  used: boolean;
  deleted: boolean;
  buyTxHash: string;
}

/**
 * 2. Extend the IGiftCode interface with Mongoose's Document interface.
 */
interface IGiftCodeDocument extends IGiftCode, Document {}

/**
 * 3. Define the schema corresponding to the IGiftCode interface.
 */
const GiftCodeSchema: Schema<IGiftCodeDocument> = new Schema({
  userAddress: { type: String, required: true },
  transactionHash: { type: String, required: true },
  code: { type: String, required: true },
  used: { type: Boolean, required: true, default: false },
  deleted: { type: Boolean, required: true, default: false },
  buyTxHash: { type: String, required: true },
});

/**
 * 4. Create a Mongoose model from the schema.
 */
const GiftCode: Model<IGiftCodeDocument> = mongoose.model<IGiftCodeDocument>(
  'gift-codes',
  GiftCodeSchema
);

/**
 * Function to read codes from a CSV file
 */
function readCodesFromFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  // Skip header lines and empty lines
  return lines
    .slice(2)
    .filter((line) => line.trim())
    .map((line) => line.split(',')[0]);
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MongoDB URI not specified in environment variables.');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Read all CSV files from the giftcodes directory
    const giftCodesDir = path.join(process.cwd(), 'giftcodes');
    const files = fs
      .readdirSync(giftCodesDir)
      .filter((file) => file.endsWith('.csv'));

    let totalCodesProcessed = 0;
    let totalCodesUpdated = 0;

    for (const file of files) {
      console.log(`Processing file: ${file}`);
      const filePath = path.join(giftCodesDir, file);
      const codes = readCodesFromFile(filePath);
      totalCodesProcessed += codes.length;

      // Update all unused codes for this file
      const result = await GiftCode.updateMany(
        {
          code: { $in: codes },
          used: false,
        },
        {
          $set: {
            used: true,
            buyTxHash: 'INVALIDATED_GIFT_CODE',
          },
        }
      );

      totalCodesUpdated += result.modifiedCount;
      console.log(`Updated ${result.modifiedCount} codes from ${file}`);
    }

    console.log('\nSummary:');
    console.log(`Total codes processed: ${totalCodesProcessed}`);
    console.log(`Total codes updated: ${totalCodesUpdated}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the main function
main();
