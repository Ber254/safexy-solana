"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet, type AnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { BN } from "@coral-xyz/anchor";
import {
  configPda,
  escrowPda,
  feeFor,
  getProgram,
  isExpired,
  lamportsToSol,
  liveDeadline,
  PROGRAM_ID,
  solToLamports,
  stateName,
  type EscrowWithAddress,
} from "@/lib/program";

const short = (k: PublicKey) => `${k.toBase58().slice(0, 4)}…${k.toBase58().slice(-4)}`;
const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const nowSec = () => Math.floor(Date.now() / 1000);

const fmtDeadline = (ts: number) => {
  const d = ts - nowSec();
  if (d <= 0) return "expired";
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : `${h}h ${m}m left`;
};

export default function EscrowApp() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, signTransaction } = wallet;

  const program = useMemo(
    () =>
      publicKey && wallet.wallet
        ? getProgram(wallet as unknown as AnchorWallet)
        : null,
    [publicKey, wallet]
  );

  const [config, setConfig] = useState<{
    platform: PublicKey;
    feeBps: BN;
    acceptanceWindow: BN;
    disputeWindow: BN;
  } | null>(null);
  const [escrows, setEscrows] = useState<EscrowWithAddress[]>([]);
  const [seller, setSeller] = useState("");
  const [amount, setAmount] = useState("");
  const [counterAmount, setCounterAmount] = useState<Record<string, string>>({});
  const [releaseTx, setReleaseTx] = useState("");
  const [partialTx, setPartialTx] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSig, setLastSig] = useState("");

  const refresh = useCallback(async () => {
    if (!program) return;
    try {
      const cfg = await program.account.config.fetchNullable(configPda());
      if (cfg) setConfig(cfg as never);
      const all = await program.account.escrow.all();
      setEscrows(
        all.filter(
          (e) =>
            publicKey &&
            (e.account.buyer.equals(publicKey) ||
              e.account.seller.equals(publicKey))
        )
      );
    } catch (e) {
      console.error(e);
    }
  }, [program, publicKey]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      const sig = await fn();
      setLastSig(sig);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createEscrow = () =>
    run(async () => {
      const sellerKey = new PublicKey(seller.trim());
      const escrowId = Math.floor(Math.random() * 2 ** 31);
      const lamports = solToLamports(parseFloat(amount));
      const escrow = escrowPda(publicKey!, escrowId);
      return program!.methods
        .deposit(new BN(escrowId), lamports)
        .accountsPartial({
          config: configPda(),
          seller: sellerKey,
          escrow,
          buyer: publicKey!,
        })
        .rpc();
    });

  const accept = (e: EscrowWithAddress) =>
    run(() =>
      program!.methods
        .accept()
        .accountsPartial({ escrow: e.publicKey, seller: publicKey! })
        .rpc()
    );

  const counterOffer = (e: EscrowWithAddress) =>
    run(() =>
      program!.methods
        .counterOffer(solToLamports(parseFloat(counterAmount[e.publicKey.toBase58()] ?? "0")))
        .accountsPartial({ escrow: e.publicKey, seller: publicKey! })
        .rpc()
    );

  const rejectCounter = (e: EscrowWithAddress) =>
    run(() =>
      program!.methods
        .rejectCounterOffer()
        .accountsPartial({ escrow: e.publicKey, buyer: publicKey! })
        .rpc()
    );

  const refund = (e: EscrowWithAddress) =>
    run(() =>
      program!.methods
        .refund()
        .accountsPartial({ escrow: e.publicKey, buyer: publicKey! })
        .rpc()
    );

  const expire = (e: EscrowWithAddress) =>
    run(() =>
      program!.methods
        .expire()
        .accountsPartial({
          escrow: e.publicKey,
          buyerWallet: e.account.buyer,
          caller: publicKey!,
        })
        .rpc()
    );

  /// Release needs A + B. Either side builds a partially-signed transaction
  /// here; the other party pastes it below and co-signs.
  const buildRelease = async (e: EscrowWithAddress) => {
    setError("");
    try {
      const tx = await program!.methods
        .release()
        .accountsPartial({
          platform: config!.platform,
          config: configPda(),
          escrow: e.publicKey,
          seller: e.account.seller,
          buyer: e.account.buyer,
        })
        .transaction();
      tx.feePayer = publicKey!;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await signTransaction!(tx);
      const b64 = signed
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64");
      setPartialTx((m) => ({ ...m, [e.publicKey.toBase58()]: b64 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const coSignRelease = () =>
    run(async () => {
      const tx = Transaction.from(Buffer.from(releaseTx.trim(), "base64"));
      const signed = await signTransaction!(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      return sig;
    });

  const grossFor = (e: EscrowWithAddress) =>
    stateName(e.account.state as object) === "counterOffer"
      ? e.account.counterOfferAmount.toNumber()
      : e.account.amount.toNumber();

  const myRole = (e: EscrowWithAddress) =>
    e.account.buyer.equals(publicKey!)
      ? "A (depositor)"
      : "B (receiver)";

  return (
    <main>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1>SAFXY Escrow</h1>
            <div className="muted">
              Solana Devnet · program {short(PROGRAM_ID)}
              {config && (
                <>
                  {" "}· fee {config.feeBps.toNumber() / 100}% · platform{" "}
                  {short(config.platform)}
                </>
              )}
            </div>
          </div>
          <WalletMultiButton />
        </div>
      </div>

      {!publicKey && (
        <div className="panel muted">Connect a wallet (Phantom / Solflare) to continue.</div>
      )}

      {publicKey && (
        <>
          <div className="panel">
            <h3>Create escrow</h3>
            <div className="row">
              <input
                placeholder="Seller (B) wallet address"
                value={seller}
                onChange={(e) => setSeller(e.target.value)}
              />
              <input
                placeholder="Amount (SOL)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ minWidth: 140 }}
              />
              <button disabled={busy || !seller || !amount} onClick={createEscrow}>
                Deposit
              </button>
            </div>
            <div className="muted">
              Locks SOL in an escrow PDA. B has 48h to accept, 60 days total to
              reach an agreement.
            </div>
          </div>

          {escrows.map((e) => {
            const st = stateName(e.account.state as object);
            const expired = isExpired(e.account, nowSec());
            const iAmBuyer = e.account.buyer.equals(publicKey);
            const gross = grossFor(e);
            const fee = feeFor(gross, e.account.feeBps.toNumber());
            return (
              <div className="panel" key={e.publicKey.toBase58()}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <span className={`badge ${st}`}>{st}</span>{" "}
                    <strong>{lamportsToSol(e.account.amount)} SOL</strong>
                  </div>
                  <div className="muted">
                    {fmtDeadline(liveDeadline(e.account))} · {myRole(e)}
                  </div>
                </div>
                <div className="muted" style={{ margin: "8px 0" }}>
                  escrow {short(e.publicKey)} · A {short(e.account.buyer)} · B{" "}
                  {short(e.account.seller)}
                  {st !== "created" && (
                    <>
                      {" "}· on release: B ← {lamportsToSol(gross - fee)} SOL,
                      platform ← {lamportsToSol(fee)} SOL
                      {st === "counterOffer" &&
                        `, A ← ${lamportsToSol(e.account.amount.toNumber() - gross)} SOL`}
                    </>
                  )}
                </div>
                <div className="row">
                  {!iAmBuyer && st === "created" && !expired && (
                    <button disabled={busy} onClick={() => accept(e)}>
                      Accept
                    </button>
                  )}
                  {!iAmBuyer && st === "accepted" && !expired && (
                    <>
                      <input
                        placeholder="You receive (SOL)"
                        style={{ minWidth: 160 }}
                        value={counterAmount[e.publicKey.toBase58()] ?? ""}
                        onChange={(ev) =>
                          setCounterAmount((m) => ({
                            ...m,
                            [e.publicKey.toBase58()]: ev.target.value,
                          }))
                        }
                      />
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => counterOffer(e)}
                      >
                        Counter-offer
                      </button>
                    </>
                  )}
                  {iAmBuyer && st === "counterOffer" && !expired && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => rejectCounter(e)}
                    >
                      Reject counter-offer
                    </button>
                  )}
                  {(st === "accepted" || st === "counterOffer") && !expired && (
                    <button disabled={busy} onClick={() => buildRelease(e)}>
                      Build release tx (needs A+B)
                    </button>
                  )}
                  {iAmBuyer && (st === "created" || expired) && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => refund(e)}
                    >
                      Refund
                    </button>
                  )}
                  {expired && (
                    <button className="danger" disabled={busy} onClick={() => expire(e)}>
                      Expire → return to A
                    </button>
                  )}
                </div>
                {partialTx[e.publicKey.toBase58()] && (
                  <div style={{ marginTop: 8 }}>
                    <div className="muted">
                      Partially-signed release — send this to the other party:
                    </div>
                    <textarea
                      readOnly
                      rows={3}
                      value={partialTx[e.publicKey.toBase58()]}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {escrows.length === 0 && (
            <div className="panel muted">No escrows for this wallet yet.</div>
          )}

          <div className="panel">
            <h3>Co-sign a release</h3>
            <div className="muted">
              Paste the partially-signed release the other party built, sign it
              with your wallet and submit. On-chain split: gross −1% to B, 1% to
              the platform, remainder to A.
            </div>
            <textarea
              rows={3}
              placeholder="base64 partially-signed transaction"
              value={releaseTx}
              onChange={(e) => setReleaseTx(e.target.value)}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button disabled={busy || !releaseTx.trim()} onClick={coSignRelease}>
                Co-sign &amp; submit release
              </button>
            </div>
          </div>
        </>
      )}

      {error && <div className="panel error">{error}</div>}
      {lastSig && (
        <div className="panel">
          <div className="muted">Last transaction:</div>
          <a className="sig" href={explorer(lastSig)} target="_blank" rel="noreferrer">
            {lastSig}
          </a>
        </div>
      )}
    </main>
  );
}
