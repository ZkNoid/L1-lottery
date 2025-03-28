// import { UInt32 } from 'o1js';

// export const safeFetchEvents = async (
//   fetcher: (from: UInt32, to: UInt32) => Promise<any[]>,
//   from: UInt32 = UInt32.zero,
//   to: UInt32 = UInt32.MAXINT()
// ) => {
//   const BATCH_SIZE = 5;

//   if (to.equals(UInt32.MAXINT())) {
//     to = UInt32.from(await getCurrentBlock());
//   }

//   const result = [];

//   let batches = +to.sub(from).div(BATCH_SIZE);

//   for (let i = 0; i < batches; i++) {
//     result.push(...(await fetcher(from, to)));
//   }

//   return result;
// };
