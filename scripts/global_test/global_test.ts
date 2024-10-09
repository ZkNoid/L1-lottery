// import fs from 'fs/promises';
// import { AccountUpdate, Lightnet, Mina, NetworkId, PrivateKey } from 'o1js';
// import { ZkonRequestCoordinator, ZkonZkProgram } from 'zkon-zkapp';
// import { getRandomManager } from '../../src/Random/RandomManager';
// import { getPLottery } from '../../src/PLottery';
// import { DistributionProgram } from '../../src/Proofs/DistributionProof';
// import { TicketReduceProgram } from '../../src/Proofs/TicketReduceProof';
// import { deployToLightnet } from './deploy_lightnet';
// import { TestOperator } from './events';

// function sleep(ms: number) {
//   return new Promise((resolve) => {
//     setTimeout(resolve, ms);
//   });
// }

// const iterations = 1000;
// const waitAmount = 30000;
// const { lottery, randomManager } = await deployToLightnet();

// const operator = new TestOperator();

// // for (let i = 0; i < iterations; i++) {
// //   await operator.invokeNextEvent(lottery);
// //   await sleep(waitAmount);
// // }
