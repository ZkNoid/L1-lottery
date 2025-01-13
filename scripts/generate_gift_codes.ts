import mongoose, { Schema, Document, Model } from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';

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
 * Utility function to generate a random hexadecimal string of a given length.
 * @param length Length of the hexadecimal string
 */
function generateRandomHex(length: number): string {
  let result = '';
  const characters = 'abcdef0123456789';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

async function main() {
  // Parse command-line arguments
  const countArg = process.argv[2];
  const fileArg = process.argv[3];

  if (!countArg || !fileArg) {
    console.error('Usage: node script.js <number_of_codes> <output_filename>');
    process.exit(1);
  }

  const count = parseInt(countArg, 10);
  if (isNaN(count) || count <= 0) {
    console.error('Invalid number of codes specified.');
    process.exit(1);
  }
  const filename = fileArg;

  if (fs.existsSync(filename)) {
    throw new Error(`File "${filename}" already exists.`);
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MongoDB URI not specified in environment variables.');
    process.exit(1);
  }

  try {
    console.log(mongoUri);
    // Connect to the MongoDB database
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Define an array of IGiftCode objects (plain data)
    const giftCodes: IGiftCode[] = [];

    // Generate an array of random gift codes
    for (let i = 0; i < count; i++) {
      giftCodes.push({
        userAddress: 'SCRIPT_GENERATED_CODE', // Random Ethereum-like address
        transactionHash: 'SCRIPT_GENERATED_CODE', // Random transaction hash
        code: generateRandomHex(16), // Random gift code
        used: false,
        deleted: false,
        buyTxHash: 'SCRIPT_GENERATED_CODE', // Random purchase transaction hash
      });
    }

    // Write generated codes to the specified file
    fs.writeFileSync(
      filename,
      JSON.stringify(
        giftCodes.map((info) => info.code),
        null,
        2
      )
    );
    console.log(`Generated codes written to file: ${filename}`);

    // Insert generated gift codes into the database
    await GiftCode.insertMany(giftCodes);
    console.log(`${count} gift codes inserted into the database.`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the connection after operation
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the main function
main();
