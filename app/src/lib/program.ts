import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import idl from "../idl/safexy_escrow.json";
import type { SafexyEscrow } from "../idl/types";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    (idl as { address: string }).address
);

export const connection = new Connection(RPC_URL, "confirmed");

export function getProgram(wallet: AnchorWallet): Program<SafexyEscrow> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program<SafexyEscrow>(
    { ...(idl as object), address: PROGRAM_ID.toBase58() } as SafexyEscrow,
    provider
  );
}

export const CONFIG_SEED = Buffer.from("config");
export const ESCROW_SEED = Buffer.from("escrow");

export const configPda = () =>
  PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];

export const escrowPda = (buyer: PublicKey, escrowId: BN | number) =>
  PublicKey.findProgramAddressSync(
    [
      ESCROW_SEED,
      buyer.toBuffer(),
      new BN(escrowId).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  )[0];

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const solToLamports = (sol: number) =>
  new BN(Math.round(sol * LAMPORTS_PER_SOL));
export const lamportsToSol = (lamports: BN | number) =>
  (typeof lamports === "number" ? lamports : lamports.toNumber()) /
  LAMPORTS_PER_SOL;

export type EscrowAccount = anchor.IdlAccounts<SafexyEscrow>["escrow"];
export type EscrowWithAddress = {
  publicKey: PublicKey;
  account: EscrowAccount;
};

export type EscrowStateName =
  | "created"
  | "accepted"
  | "counterOffer"
  | "released"
  | "refunded"
  | "expired";

export const stateName = (state: object): EscrowStateName =>
  Object.keys(state)[0] as EscrowStateName;

export const feeFor = (gross: number, feeBps: number) =>
  gross === 0 || feeBps === 0 ? 0 : Math.ceil((gross * feeBps) / 10_000);

/// Live deadline for an escrow: 48h acceptance window while `created`,
/// 60-day dispute window afterwards.
export const liveDeadline = (e: EscrowAccount): number =>
  stateName(e.state as object) === "created"
    ? e.acceptanceDeadline.toNumber()
    : e.disputeDeadline.toNumber();

export const isExpired = (e: EscrowAccount, nowSec: number) =>
  nowSec > liveDeadline(e);
