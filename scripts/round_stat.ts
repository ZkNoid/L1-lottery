import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { RoundsDataModel, RoundTickets } from './data_models/RoundInfo.js';

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('MongoDB URI not specified in environment variables.');
  process.exit(1);
}

await mongoose.connect(mongoUri);
console.log('Connected to MongoDB');

const rounds = [...Array(26)]
  .map((v, i) => i)
  .filter((v) => v >= 12 && v <= 23);

console.log(`Rounds: ${rounds}`);

let firstWeekRounds = await RoundsDataModel.find({
  roundId: { $in: rounds },
});

let totalUniqueTickets = firstWeekRounds.reduce(
  (acc, round) => round.tickets.length + acc,
  0
);

let totalBank = firstWeekRounds.reduce((acc, round) => acc + +round.bank, 0);

let usersSet = new Set();

for (const round of firstWeekRounds) {
  round.tickets.forEach((ticket) => usersSet.add(ticket.owner));
}

console.log(`Total tickets: ${totalUniqueTickets}`);
console.log(`Total bank: ${totalBank * 10 * 0.9}`);
console.log(`Total unique users: ${usersSet.size}`);
