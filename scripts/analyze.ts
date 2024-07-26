import { PLottery } from '../src/PLottery.js';
import { DistibutionProgram } from '../src/DistributionProof.js';
import { writeFileSync } from 'fs';

const lotteryResult = await PLottery.analyzeMethods();
const distributionResult = await DistibutionProgram.analyzeMethods();

if (!PLottery._methods) {
  console.log("Can't find methods for Lottery");
  throw new Error("Can't find methods for Lottery");
}

let result: { [name: string]: number } = {};

for (const method of PLottery._methods) {
  result[`Lottery_${method.methodName}`] =
    lotteryResult[method.methodName].rows;
}

result[`DistributionProof_init`] = distributionResult.init.rows;
result[`DistibutionProof_addTicket`] = distributionResult.addTicket.rows;

console.log(result);

writeFileSync('analyze_result.json', JSON.stringify(result, null, 2));
