// Dev helper: initializes config (tiny windows) and creates one escrow that
// will hit its acceptance deadline in ~20s, for exercising the keeper locally.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import idl from "../program/target/idl/safexy_escrow.json";
import type { SafexyEscrow } from "./safexy_escrow";

const RPC = process.env.SOLANA_RPC_URL ?? "http://localhost:8899";
const kp = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))
  )
);

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), {
    commitment: "confirmed",
  });
  const program = new Program<SafexyEscrow>(idl as SafexyEscrow, provider);
  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  if (!(await connection.getAccountInfo(config))) {
    console.log(
      "init config:",
      await program.methods
        .initializeConfig(
          kp.publicKey,
          kp.publicKey,
          new BN(100),
          new BN(20), // acceptance window (s)
          new BN(120), // dispute window (s)
          new BN(1_000_000)
        )
        .accounts({ config, authority: kp.publicKey })
        .rpc()
    );
  }

  const seller = Keypair.generate().publicKey;
  const escrow = PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      kp.publicKey.toBuffer(),
      new BN(7).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  )[0];

  console.log(
    "deposit:",
    await program.methods
      .deposit(new BN(7), new BN(0.01 * LAMPORTS_PER_SOL))
      .accountsPartial({
        config,
        seller,
        escrow,
        buyer: kp.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  );
  console.log("escrow to expire:", escrow.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
