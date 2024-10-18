import dotenv from 'dotenv';
dotenv.config();

import { readFileSync, writeFileSync } from 'fs';
import { PinataSDK } from 'pinata';

// bafkreif2ett25ddjcevhnmaxmimkjdoigtsaj6bfyfil5gu65l2r6luxqm

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT!,
  pinataGateway: process.env.PINATA_GATEWAY,
});

// const contractCode = readFileSync('./build/src/Random/RandomManager.js');
const contractCode = readFileSync('./dist/bundledRandomManager.js');

// const json = {
//   method: 'GET',
//   baseURL: 'https://quantum-random.com/quantum',
//   path: 'seed',
//   zkapp: contractCode.toString(),
// };

const json = {
  method: 'GET',
  baseURL: 'https://random-data-api.com/api/number/random_number',
  path: 'number',
  zkapp: contractCode.toString(),
};

let response = await pinata.upload.json(json);

console.log(response.IpfsHash);
writeFileSync(
  './random_request_cid.js',
  `export const cidBuffer = '${response.IpfsHash.toString()}'`
);

writeFileSync('./random_request_file', `${JSON.stringify(json, null, 2)}`);
