// import fs from 'fs/promises';
// import {
//   Cache,
//   Mina,
//   NetworkId,
//   PrivateKey,
//   PublicKey,
//   UInt32,
//   fetchAccount,
// } from 'o1js';
// import { DistibutionProgram } from '../src/DistributionProof.js';
// import { StateManager } from '../src/StateManager.js';
// import { Ticket } from '../src/Ticket.js';
// import { BuyTicketEvent, Lottery } from '../src/Lottery.js';

// const Network = Mina.Network({
//   mina: 'https://api.minascan.io/node/devnet/v1/graphql',
//   archive: 'https://api.minascan.io/archive/devnet/v1/graphql',
// });
// // const Network = Mina.Network(config.url);
// Mina.setActiveInstance(Network);
// let lottery = new Lottery(
//   PublicKey.fromBase58(
//     'B62qrJg2tAuviSsTXUaAZLWFE5Uw4n4Gp2eubC11qY9u9rq8ZXiNAwW'
//   )
// );

// const startBlock = (await lottery.startBlock.fetch())!;

// console.log('Lottery deployed at', startBlock);

// const state = new StateManager(startBlock.toFields()[0]);

// const events = await lottery.fetchEvents(UInt32.from(0));

// for (let i = 0; i < events.length; i++) {
//   const event = events[i];
//   if (event.type == 'buy-ticket') {
//     console.log('Adding ticket to state');
//     const data = event.event.data as unknown as BuyTicketEvent;
//     state.addTicket(data.ticket, +data.round);
//   }
// }

// console.log('Root', state.ticketMap.getRoot().toJSON());
// console.log('Root2', (await lottery.ticketRoot.fetch())?.toJSON())!;
