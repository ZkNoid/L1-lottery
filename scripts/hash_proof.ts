import axios from 'axios';

let response = await axios.post(
  'https://api.minascan.io/node/devnet/v1/graphql',
  JSON.stringify({
    query: `
  query {
    bestChain(maxLength:1) {
      protocolState {
        consensusState {
          blockHeight,
          slotSinceGenesis
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
