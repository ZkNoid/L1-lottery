import axios from 'axios';

let response = await axios.post(
  'https://api.minascan.io/node/devnet/v1/graphql',
  JSON.stringify({
    query: `
  
    query {
      block (stateHash: "jxydnwVuHCGohXntpNtsYwt83x4V1yK4iGsAxENKBZ4zYD6u8xN") {
        stateHash
        protocolState {
          consensusState (blockHeight: 4) {

          }
        }
      }
    }
  
`,
  }),
  {
    headers: {
      'Content-Type': 'application/json',
    },
    responseType: 'json',
  }
);

console.log(response.data);

console.log(JSON.stringify(response.data));
