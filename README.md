# Mina L1 lottery

This repo contains smart contracts and related scripts for ZkNoid L1 Lottery proposed [here](https://forums.minaprotocol.com/t/zknoid-l1-lottery/6269)

## Technical overview

**Pre-Round Phase**

- Before a round begins, the only action permitted is committing a value for randomness.

**Active Round**

- A round is considered active if the current chain slot falls within the `[roundStartBlock, roundEndBlock]` range.

**During the Round**

- Users are allowed to `buyTickets`.

**Post-Round Actions**

- Once the round concludes, the following steps must be completed before users can claim rewards for their tickets:
  1. **Ticket Reduction**:

     - `ticketReduce` must be invoked on the `PLottery` contract. This function will reduce all tickets from the target round and at least one from the subsequent round.

  2. **Randomness Reveal**:

     - `reveal` should be called on the `RandomManager` for the target round. This will generate the seed required for winning ticket generation.

  3. **Result Production**:
     - `produceResult` must be executed on the `PLottery` contract to determine the winning ticket for the round.

**Reward Collection**

- After the above steps are completed, users can call `getReward` to claim their rewards for the tickets.

**Fallback for Result Generation**

- If the result is not produced within the next two rounds, users will be eligible to request a refund for their tickets.

### Storage usage

```ts
    @state(Field) ticketRoot = State<Field>();
    @state(Field) ticketNullifier = State<Field>();
    @state(Field) bankRoot = State<Field>();
    @state(Field) roundResultRoot = State<Field>();
    @state(UInt32) startBlock = State<UInt32>();
    @state(Field) lastProcessedState = State<Field>();
    @state(Field) lastReduceInRound = State<Field>();
    @state(Field) lastProcessedTicketId = State<Field>();
```

We are using all 8 avaliable slots:

1. ticketRoot - to store merkle tree root for ticket
2. ticketNullifier - to store merkle tree root for nullifer, so one ticket could be redeemed only once
3. bankRoot - to store bank merkle tree root for each round
4. roundResultRoot - to store winning combination for each round
5. startBlock - stores slot of deployment
6. lastProcessedState - stores last processed actions state
7. lastReduceInRound - stores round in wich last actions reduce was called. We can garantee, that in this case all tickets from previous rounds was processed by reducer
8. lastProcessedTicketId - id of last processed ticket by reducer

### Ticket purchase

For ticket purchase buyTicket method is used

```ts
@method async buyTicket(ticket: Ticket, round: Field) {
  ...
}
```

It do not update ticket merkle tree, but add action to actionList.

```ts
this.reducer.dispatch(
  new LotteryAction({
    ticket,
    round,
  })
);
```

Also it fires event:

```ts
this.emitEvent(
  'buy-ticket',
  new BuyTicketEvent({
    ticket,
    round: round,
  })
);
```

### Ticket reduce

As mentioned earlier buyTicket do not update ticket merkle tree, but add action to actionList. We can't use it directly, so we need to convert actions list to merkle tree. We do it using [ZkProgramm](src/DistributionProof.ts):

```ts
export const TicketReduceProgram = ZkProgram({
  name: 'ticket-reduce-program',
  publicInput: TicketReduceProofPublicInput,
  publicOutput: TicketReduceProofPublicOutput,
  methods: {
    init: {
      ...
    },
    addTicket: {
      ...
    },
    cutActions: {
      ...
    },
  },
});
```

### Winning number generation

For random generation we have separate [contract](src/Random/RandomManager.ts). It utilize [ZKOn](https://github.com/ZKON-Network) zk oracle and commit-reveal technique.

First we commit our hidden value:

```ts
    @method async commit(
      commitValue: CommitValue,
      commitWitness: MerkleMapWitness
    ) {
      ...
    }
```

Then send request for ZkOn oracle, with request that lies on IPFS(cid can be found [here](./random_request_cid)). It sends request on quantum-random.com to get random number.

```ts
@method async callZkon() {
  ...
  const requestId = await coordinator.sendRequest(
    this.address,
    hashPart1,
    hashPart2
  );
  ...
}
```

After we receive random number from ZKOn, we mix it with out hidden number, and store result on merkle tree.

```ts
    @method async reveal(
      commitValue: CommitValue,
      commitWitness: MerkleMapWitness,
      resultWitness: MerkleMapWitness
    ) {
      ...
      const resultValue = Poseidon.hash([commitValue.value, curRandomValue]);

      // Update result
      const [newResultRoot] = resultWitness.computeRootAndKey(resultValue);
      this.resultRoot.set(newResultRoot);
      ...
    }
```

Later we will use this number to generate winning combination

```ts
    @method async produceResult(
      resultWiness: MerkleMap20Witness,
      result: Field,
      bankValue: Field,
      bankWitness: MerkleMap20Witness,
      rmWitness: MerkleMapWitness,
      rmValue: Field
    ) {
      ...
      this.checkRandomResultValue(rmWitness, rmValue, round);

      let winningNumbers = generateNumbersSeed(rmValue);
      ...
    }


    public checkRandomResultValue(
      roundResultWitness: MerkleMapWitness,
      roundResulValue: Field,
      round: Field
    ) {
      ...
      const rm = new RandomManager(randomManagerAddress);
      const resultRoot = rm.resultRoot.getAndRequireEquals();
      ...
    }
```

### Bank distribution

Bank is distrubuted among all players fairly, according to amount of rightly guessed number.
To do so, after winning numbers generation we match score for it ticket:

- 0 numbers guessed - 0
- 1 number guessed - 90
- 2 numbers guessed - 324
- 3 numbers guessed - 2187
- 4 numbers guessed - 26244
- 5 numbers guessed - 590490
- 6 numbers guessed - 31886460

Then we compute total score for round in a provable way using [proof](src/DistributionProof.ts).

Each ticket can get roundBank \* ticketScore / totalScore tokens.

### Ticket redemption

To get winning for ticket getReward function exist. It will compute score for ticket, portion of bank, which it owns, transfer to to user, and update nullifier merkle map, so this ticket can't be used in future.

```ts
    @method async getReward(
      ticket: Ticket,
      roundWitness: MerkleMap20Witness,
      roundTicketWitness: MerkleMap20Witness,
      dp: DistributionProof,
      winningNumbers: Field,
      resutWitness: MerkleMap20Witness,
      bankValue: Field,
      bankWitness: MerkleMap20Witness,
      nullifierWitness: MerkleMapWitness
    ) {
    }
```

### Preparation

Install npm modules:

```sh
npm install
```

Prepare mina-fungible-token module:

```sh
npm run token_prepare
```

```sh
npm run build
```

### How to run tests

```sh
npm run test
```

### How to run coverage

```sh
npm run coverage
```

### How to deploy

To deploy you first need to set evironments variables:

```
DEPLOYER_KEY = ""
RANDOM_MANAGER_OWNER_ADDRESS = ""
```

Then you can deploy it using

```sh
npm run deploy
```

It will generate private and public keys for RandomManager and Lottery. Deploy them on corresponding addresses and will store addresses on deploy/addresses and store keys on keys/auto

## License

[Apache-2.0](LICENSE)
