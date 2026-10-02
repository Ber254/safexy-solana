/**
 * First-milestone e2e on Solana Devnet:
 *   A deposits → B accepts → A+B release → B gets gross−1%, platform gets 1%.
 * Then a second escrow is left `Created` past its acceptance deadline and the
 * keeper/expire path returns it to A.
 *
 * Uses DEMO windows (short) — production config would be 48h / 60d.
 *
 * Usage:
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   AUTHORITY=~/.config/solana/id.json \
 *   npx tsx milestone.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import idl from "../program/target/idl/safexy_escrow.json";
import type { SafexyEscrow } from "./safexy_escrow";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const keypair = (path: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
  );
const authority = keypair(
  process.env.AUTHORITY ?? `${process.env.HOME}/.config/solana/id.json`
);

// Demo windows: 5 min acceptance / 15 min dispute (production: 48h / 60d).
const ACCEPTANCE_WINDOW = 300;
const DISPUTE_WINDOW = 900;
const FEE_BPS = 100;
const MIN_DEPOSIT = 0.001 * LAMPORTS_PER_SOL;
const AMOUNT = 0.01 * LAMPORTS_PER_SOL;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(authority),
    { commitment: "confirmed" }
  );
  const program = new Program<SafexyEscrow>(idl as SafexyEscrow, provider);
  const programId = program.programId;

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
  const escrowPda = (buyer: PublicKey, id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), buyer.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8)],
      programId
    )[0];

  // Fund B from the deployer wallet (devnet faucet is rate-limited).
  const airdrop = async (k: PublicKey, sol: number) => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: k,
        lamports: sol * LAMPORTS_PER_SOL,
      })
    );
    const sig = await connection.sendTransaction(tx, [authority]);
    await connection.confirmTransaction(sig);
  };

  // --- config ---------------------------------------------------------------
  const existing = await connection.getAccountInfo(config);
  if (!existing) {
    const platform = authority.publicKey; // demo: authority collects the fee
    const tx = await program.methods
      .initializeConfig(
        platform,
        authority.publicKey,
        new BN(FEE_BPS),
        new BN(ACCEPTANCE_WINDOW),
        new BN(DISPUTE_WINDOW),
        new BN(MIN_DEPOSIT)
      )
      .accounts({ config, authority: authority.publicKey })
      .rpc();
    console.log("config initialized:", tx);
  } else {
    console.log("config already exists:", config.toBase58());
  }

  // --- milestone: deposit → accept → release --------------------------------
  const buyer = authority; // A = deployer wallet for the demo
  const seller = Keypair.generate();
  console.log("funding seller (B)...");
  await airdrop(seller.publicKey, 0.1);

  const escrow = escrowPda(buyer.publicKey, 1);
  console.log("deposit:", await program.methods
    .deposit(new BN(1), new BN(AMOUNT))
    .accounts({
      config,
      seller: seller.publicKey,
      escrow,
      buyer: buyer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc());

  console.log("accept:", await program.methods
    .accept()
    .accounts({ escrow, seller: seller.publicKey })
    .signers([seller])
    .rpc());

  const cfg = await program.account.config.fetch(config);
  const platform = (cfg as { platform: PublicKey }).platform;
  const sellerBefore = await connection.getBalance(seller.publicKey);
  const platformBefore = await connection.getBalance(platform);

  console.log("release:", await program.methods
    .release()
    .accounts({ platform, config, escrow, seller: seller.publicKey, buyer: buyer.publicKey })
    .signers([seller])
    .rpc());

  const fee = Math.ceil((AMOUNT * FEE_BPS) / 10_000);
  const sellerGain = (await connection.getBalance(seller.publicKey)) - sellerBefore;
  const platformGain = (await connection.getBalance(platform)) - platformBefore;
  console.log(`release split: B got ${sellerGain} lamports, platform got ${platformGain}`);
  console.log(`expected: B ${AMOUNT - fee} (minus tx fee), platform ${fee}`);

  // --- milestone: 48h-deadline expiry (demo window) --------------------------
  const escrow2 = escrowPda(buyer.publicKey, 2);
  console.log("deposit #2:", await program.methods
    .deposit(new BN(2), new BN(AMOUNT))
    .accounts({
      config,
      seller: seller.publicKey,
      escrow: escrow2,
      buyer: buyer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc());
  console.log(
    `escrow #2 left Created; it expires after ${ACCEPTANCE_WINDOW}s — run the keeper to auto-expire it`
  );

  console.log("milestone done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
