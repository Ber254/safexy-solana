import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import idl from "../idl/safexy_escrow.json";
import type { SafexyEscrow } from "./safexy_escrow";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEEPER_KEYPAIR ?? "./keeper.json";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const stateName = (state: Record<string, unknown>) => Object.keys(state)[0];

async function main() {
  const keeper = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const programId = process.env.PROGRAM_ID
    ? new PublicKey(process.env.PROGRAM_ID)
    : new PublicKey((idl as { address: string }).address);

  const wallet = new anchor.Wallet(keeper);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new Program<SafexyEscrow>(
    { ...(idl as object), address: programId.toBase58() } as SafexyEscrow,
    provider
  );

  console.log(`[keeper] rpc=${RPC_URL} program=${programId.toBase58()}`);
  console.log(`[keeper] signer=${keeper.publicKey.toBase58()}`);
  const balance = await connection.getBalance(keeper.publicKey);
  if (balance === 0) {
    console.warn("[keeper] WARNING: keeper wallet has 0 SOL — expire txs will fail");
  }

  const scan = async () => {
    const escrows = await program.account.escrow.all();
    const now = Math.floor(Date.now() / 1000);
    console.log(`[keeper] scan: ${escrows.length} escrow(s)`);

    for (const { account, publicKey } of escrows) {
      const state = stateName(account.state as Record<string, unknown>);
      const deadline =
        state === "created"
          ? account.acceptanceDeadline.toNumber()
          : account.disputeDeadline.toNumber();
      const expired = now > deadline;
      if (!expired) continue;

      console.log(
        `[keeper] expiring ${publicKey.toBase58()} (state=${state}, deadline=${deadline}, now=${now})`
      );
      try {
        const sig = await program.methods
          .expire()
          .accountsPartial({
            escrow: publicKey,
            buyerWallet: account.buyer,
            caller: keeper.publicKey,
          })
          .signers([keeper])
          .rpc();
        console.log(`[keeper] expired ${publicKey.toBase58()} tx=${sig}`);
      } catch (err) {
        console.error(`[keeper] expire failed for ${publicKey.toBase58()}:`, err);
      }
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await scan();
    } catch (err) {
      console.error("[keeper] scan failed:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
