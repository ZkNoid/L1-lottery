import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { readFileSync, writeFileSync } from 'fs';

const contractCode = readFileSync('./build/src/Random/RandomManager.js');

// create a Helia node
const helia = await createHelia();
const ipfs = unixfs(helia);

const encoder = new TextEncoder();
const json = {
  method: 'GET',
  baseURL: 'https://quantum-random.com/quantum',
  path: 'seed',
  zkapp: contractCode.toString(),
};

console.log(json);

const bytes = encoder.encode(JSON.stringify(json));

// add the bytes to your node and receive a unique content identifier
const cid = await ipfs.addBytes(bytes);

console.log(cid);
writeFileSync('./random_request_cid', cid.toString());

writeFileSync('./random_request_file', JSON.stringify(json, null, 2));
