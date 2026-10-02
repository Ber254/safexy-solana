# safexy-keeper

Solana programs cannot self-execute on a deadline — this bot watches every
escrow account and submits `expire` once its deadline passes:

- `Created` + `acceptance_deadline` elapsed → refund to A
- `Accepted` / `CounterOffer` + `dispute_deadline` elapsed → refund to A

`expire` is permissionless on-chain (the payout is hard-coded to A), so the
keeper wallet only needs SOL for transaction fees — it never touches funds.

## Setup

```bash
cp .env.example .env            # edit values
solana-keygen new -o keeper.json  # or reuse an existing keypair
# fund the keeper with a little devnet SOL for tx fees
npm install
npm start
```

`SOLANA_RPC_URL` defaults to devnet; `PROGRAM_ID` defaults to the IDL's
address (synced from `program/target/idl` by `scripts/sync-idl.sh`).

Logs look like:

```
[keeper] rpc=https://api.devnet.solana.com program=3XtS…
[keeper] scan: 4 escrow(s)
[keeper] expiring 7kP… (state=created, deadline=…)
[keeper] expired 7kP… tx=5Hx…
```
