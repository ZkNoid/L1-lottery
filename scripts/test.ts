import { fetchAccount, PublicKey } from 'o1js';
import { configDefaultInstance } from './utils.js';

const { transactionFee } = configDefaultInstance();

console.log(
  await fetchAccount({
    publicKey: PublicKey.fromBase58(
      'B62qmeY6f7B1Yu6bj3KYDpTq8Gkon7SnyMGNFMvWsquW2N1QiwspKC6'
    ),
  })
);

console.log(
  await fetchAccount({
    publicKey: PublicKey.fromBase58(
      'B62qmhiVXkRzErWTB3DJEpKkrziMY4ypKyaebEyaBx2LYVLZNaEhDyo'
    ),
  })
);

console.log(
  await fetchAccount({
    publicKey: PublicKey.fromBase58(
      'B62qrPDNsV5MAvK1H7gWf75VzuAQFFK8cTkFWBdGyMi4T3JVQd9p5Uz'
    ),
  })
);
