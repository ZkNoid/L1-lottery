import {
  Mina,
  PublicKey,
} from 'o1js';
import {  PLottery } from '../src/PLottery.js';

const Network = Mina.Network({
  mina: 'https://api.minascan.io/node/devnet/v1/graphql',
  archive: 'https://api.minascan.io/archive/devnet/v1/graphql',
});

Mina.setActiveInstance(Network);

let lottery = new PLottery(
  PublicKey.fromBase58(
    'B62qk3U9ZUZ2a21T4thqhUgBvXM3xMyA1HtQBQ79unUHrytEVpNhtqm'
  )
);


console.log('Actions', await lottery.reducer.fetchActions());
