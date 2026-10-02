# safexy-solana — P2P escrow on Solana

Peer-to-peer escrow between a depositor **A** (buyer) and a receiver **B**
(seller), enforced by an Anchor program on Solana Devnet.

Functional port of the SAFEXY escrow logic already implemented for
Stellar (`stellar-rental-guarantee`) and Cardano (`safexy-cardano`).

## Business rules

- **A** deposits SOL into an escrow PDA; only A signs.
- **B** has **48h** to accept. After the deadline `accept` fails on-chain and
  the funds can return to A (`refund` by A, or `expire` by anyone).
- Once accepted, at the end of the agreed term **A requests release**; the
  release transaction needs **A + B signatures** (mutual agreement).
- B can approve (co-sign release), deny (not sign) or **counteroffer** a lower
  amount for himself. A can reject the counteroffer (back to `Accepted`) or
  accept it by co-signing the release.
- If there is no agreement within **60 days** of the deposit, `expire` /
  `refund` returns everything to A.
- On release the **program itself** splits the lamports: **1% platform fee**
  (`fee_bps = 100`, rounded up to the lamport). For 1000 SOL released,
  B receives 990 SOL and the platform 10 SOL — enforced inside the
  instruction, not by the transaction builder.

## Escrow states

`Created` → `Accepted` → `CounterOffer` ⇄ `Accepted` → terminal.

On Solana the terminal states (`Released`, `Refunded`, `Expired`) are reached
by **closing** the escrow account — the enum keeps all six for the IDL and
events, and every transition emits an `EscrowEvent` for indexers/frontends.

| Instruction | Signers | State / time rule | Result |
| --- | --- | --- | --- |
| `deposit(id, amount)` | A | `amount >= min_deposit`, A ≠ B | creates escrow `Created`, locks `amount` |
| `accept()` | B | `Created`, `now <= acceptance_deadline` | `Accepted` |
| `counter_offer(x)` | B | `Accepted`, `now <= dispute_deadline`, `0 < x <= amount` | `CounterOffer` |
| `reject_counter_offer()` | A | `CounterOffer`, `now <= dispute_deadline` | `Accepted` |
| `release()` | A + B | `Accepted` or `CounterOffer`, `now <= dispute_deadline` | B ← gross−fee, platform ← fee, A ← rest; account closed |
| `refund()` | A | `Created` (any time) or `now > dispute_deadline` | A ← everything; account closed |
| `expire()` | anyone (keeper) | `Created` after 48h, else after 60d | A ← everything; account closed |

`expire` is permissionless because the payout destination is fixed to A —
this is what lets the keeper bot work without holding A's keys.

## Repository layout

```
safexy-solana/
├── program/   # Anchor program (Rust) — programs/safexy-escrow
├── app/       # Next.js frontend (Solana Wallet Adapter / Phantom)
├── keeper/    # Keeper bot: scans escrows, submits `expire` on deadlines
└── tests/     # Devnet milestone / e2e scripts
```

Program tests live in `program/tests/` (Anchor convention).

## Requirements

- Rust + [Solana CLI (Agave)](https://anza.xyz) + [Anchor](https://anchor-lang.com) 0.32.x
- Node ≥ 22, npm

## Commands

```bash
# program
cd program
npm install
anchor build                    # build + IDL
anchor test                     # local validator, full escrow lifecycle tests
anchor deploy --provider.cluster devnet

# frontend
cd app && npm install && npm run dev     # http://localhost:3000

# keeper
cd keeper && npm install
KEEPER_KEYPAIR=./keeper.json npm start
```

## Config PDA

One `config` PDA (seed `"config"`) holds `platform` wallet, `keeper`, `fee_bps`,
`acceptance_window`, `dispute_window` and `min_deposit`. It is created once by
`initialize_config` and can be updated by the authority — new deposits snapshot
`fee_bps` and compute their deadlines from the current windows, so tests and
devnet can use short windows while production uses 48h / 60d.

Each escrow is a PDA seeded `["escrow", buyer, escrow_id]` holding both its
data and the locked lamports.
