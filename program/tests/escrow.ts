import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import { SafexyEscrow } from "../target/types/safexy_escrow";

// Short windows so deadlines can be exercised on a local validator.
const ACCEPTANCE_WINDOW = 5; // seconds (production: 48h)
const DISPUTE_WINDOW = 25; // seconds (production: 60d)
const FEE_BPS = 100; // 1%
const MIN_DEPOSIT = new BN(0.001 * LAMPORTS_PER_SOL);
const AMOUNT = new BN(0.1 * LAMPORTS_PER_SOL);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const expectFail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch {
    return;
  }
  throw new Error("expected transaction to fail but it succeeded");
};

describe("safexy-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.safexyEscrow as Program<SafexyEscrow>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  const keeper = Keypair.generate();
  const platform = Keypair.generate();
  const outsider = Keypair.generate();

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const escrowPda = (b: PublicKey, id: number) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        b.toBuffer(),
        new BN(id).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];

  const fund = async (k: Keypair, sol: number) => {
    const sig = await connection.requestAirdrop(
      k.publicKey,
      sol * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig);
  };

  const deposit = async (id: number, amount = AMOUNT) => {
    const escrow = escrowPda(buyer.publicKey, id);
    await program.methods
      .deposit(new BN(id), amount)
      .accounts({
        config,
        seller: seller.publicKey,
        escrow,
        buyer: buyer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    return escrow;
  };

  before(async () => {
    await fund(buyer, 2);
    await fund(seller, 1);
    await fund(keeper, 1);
    await fund(outsider, 1);
    await program.methods
      .initializeConfig(
        platform.publicKey,
        keeper.publicKey,
        new BN(FEE_BPS),
        new BN(ACCEPTANCE_WINDOW),
        new BN(DISPUTE_WINDOW),
        MIN_DEPOSIT
      )
      .accounts({ config, authority: payer.publicKey })
      .rpc();
  });

  it("initializes the config", async () => {
    const c = await program.account.config.fetch(config);
    expect(c.feeBps.toNumber()).to.equal(FEE_BPS);
    expect(c.platform.toBase58()).to.equal(platform.publicKey.toBase58());
  });

  it("deposit: A locks funds, escrow starts in Created with deadlines", async () => {
    const escrow = await deposit(1);
    const e = await program.account.escrow.fetch(escrow);
    expect(e.state).to.deep.equal({ created: {} });
    expect(e.amount.toNumber()).to.equal(AMOUNT.toNumber());
    expect(e.disputeDeadline.toNumber() - e.acceptanceDeadline.toNumber()).to.equal(
      DISPUTE_WINDOW - ACCEPTANCE_WINDOW
    );
    const bal = await connection.getBalance(escrow);
    expect(bal).to.be.greaterThanOrEqual(AMOUNT.toNumber());
  });

  it("deposit below the minimum fails", async () => {
    const escrow = escrowPda(buyer.publicKey, 99);
    await expectFail(
program.methods
        .deposit(new BN(99), new BN(1))
        .accounts({
          config,
          seller: seller.publicKey,
          escrow,
          buyer: buyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc()
    );
  });

  it("accept: B accepts within the window", async () => {
    const escrow = escrowPda(buyer.publicKey, 1);
    await program.methods
      .accept()
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();
    const e = await program.account.escrow.fetch(escrow);
    expect(e.state).to.deep.equal({ accepted: {} });
  });

  it("accept: A cannot accept his own escrow", async () => {
    const escrow = await deposit(2);
    await expectFail(
program.methods
        .accept()
        .accounts({ escrow, seller: buyer.publicKey })
        .signers([buyer])
        .rpc()
    );
  });

  it("accept after the acceptance deadline fails, then keeper expires it", async () => {
    const escrow = await deposit(3);
    await sleep((ACCEPTANCE_WINDOW + 2) * 1000);
    await expectFail(
program.methods
        .accept()
        .accounts({ escrow, seller: seller.publicKey })
        .signers([seller])
        .rpc()
    );

    const buyerBefore = await connection.getBalance(buyer.publicKey);
    await program.methods
      .expire()
      .accounts({ escrow, buyerWallet: buyer.publicKey, caller: keeper.publicKey })
      .signers([keeper])
      .rpc();
    const info = await connection.getAccountInfo(escrow);
    expect(info).to.be.null;
    const buyerAfter = await connection.getBalance(buyer.publicKey);
    expect(buyerAfter).to.be.greaterThan(buyerBefore);
  });

  it("expire before the deadline fails", async () => {
    const escrow = await deposit(4);
    await expectFail(
program.methods
        .expire()
        .accounts({ escrow, buyerWallet: buyer.publicKey, caller: keeper.publicKey })
        .signers([keeper])
        .rpc()
    );
  });

  it("refund: A takes funds back while Created", async () => {
    const escrow = escrowPda(buyer.publicKey, 4);
    const before = await connection.getBalance(buyer.publicKey);
    await program.methods
      .refund()
      .accounts({ escrow, buyer: buyer.publicKey })
      .signers([buyer])
      .rpc();
    expect(await connection.getAccountInfo(escrow)).to.be.null;
    expect(await connection.getBalance(buyer.publicKey)).to.be.greaterThan(
      before
    );
  });

  it("release: mutual release pays B gross-1% and platform 1%", async () => {
    const escrow = await deposit(5);
    await program.methods
      .accept()
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();

    const sellerBefore = await connection.getBalance(seller.publicKey);
    const platformBefore = await connection.getBalance(platform.publicKey);

    await program.methods
      .release()
      .accounts({
        platform: platform.publicKey,
        config,
        escrow,
        seller: seller.publicKey,
        buyer: buyer.publicKey,
      })
      .signers([seller, buyer])
      .rpc();

    const gross = AMOUNT.toNumber();
    const fee = Math.ceil((gross * FEE_BPS) / 10_000);
    const sellerAfter = await connection.getBalance(seller.publicKey);
    const platformAfter = await connection.getBalance(platform.publicKey);

    // seller pays the tx fee (~5000 lamports) for co-signing
    expect(gross - fee - (sellerAfter - sellerBefore)).to.be.lessThan(10_000);
    expect(platformAfter - platformBefore).to.equal(fee);
    expect(await connection.getAccountInfo(escrow)).to.be.null;
  });

  it("release with a single signer fails", async () => {
    const escrow = await deposit(6);
    await program.methods
      .accept()
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();
    await expectFail(
program.methods
        .release()
        .accounts({
          platform: platform.publicKey,
          config,
          escrow,
          seller: seller.publicKey,
          buyer: buyer.publicKey,
        })
        .signers([buyer]) // missing seller signature
        .rpc()
    );
  });

  it("counteroffer + release: B gets his amount minus fee, A the rest", async () => {
    const escrow = await deposit(7);
    await program.methods
      .accept()
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();

    const sellerAmount = AMOUNT.div(new BN(2));
    await program.methods
      .counterOffer(sellerAmount)
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();
    let e = await program.account.escrow.fetch(escrow);
    expect(e.state).to.deep.equal({ counterOffer: {} });
    expect(e.counterOfferAmount.toNumber()).to.equal(sellerAmount.toNumber());

    const sellerBefore = await connection.getBalance(seller.publicKey);
    const platformBefore = await connection.getBalance(platform.publicKey);
    const buyerBefore = await connection.getBalance(buyer.publicKey);

    await program.methods
      .release()
      .accounts({
        platform: platform.publicKey,
        config,
        escrow,
        seller: seller.publicKey,
        buyer: buyer.publicKey,
      })
      .signers([seller, buyer])
      .rpc();

    const gross = sellerAmount.toNumber();
    const fee = Math.ceil((gross * FEE_BPS) / 10_000);
    expect(
      gross - fee - ((await connection.getBalance(seller.publicKey)) - sellerBefore)
    ).to.be.lessThan(10_000);
    expect((await connection.getBalance(platform.publicKey)) - platformBefore).to.equal(fee);
    // buyer gets back amount - gross (plus rent, minus tx fees)
    const buyerGain = (await connection.getBalance(buyer.publicKey)) - buyerBefore;
    expect(buyerGain).to.be.greaterThanOrEqual(AMOUNT.toNumber() - gross);
  });

  it("reject counteroffer: A sends the escrow back to Accepted", async () => {
    const escrow = await deposit(8);
    await program.methods
      .accept()
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();
    await program.methods
      .counterOffer(new BN(1_000_000))
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();
    await program.methods
      .rejectCounterOffer()
      .accounts({ escrow, buyer: buyer.publicKey })
      .signers([buyer])
      .rpc();
    const e = await program.account.escrow.fetch(escrow);
    expect(e.state).to.deep.equal({ accepted: {} });
  });

  it("refund after acceptance before the 60d deadline fails; expire works after", async () => {
    const escrow = await deposit(9);
    await program.methods
      .accept()
      .accounts({ escrow, seller: seller.publicKey })
      .signers([seller])
      .rpc();
    await expectFail(
program.methods
        .refund()
        .accounts({ escrow, buyer: buyer.publicKey })
        .signers([buyer])
        .rpc()
    );

    // Wait out the dispute window, then the keeper expires it. The test
    // validator's clock can lag wall time slightly, so retry for a bit.
    await sleep(DISPUTE_WINDOW * 1000);
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        await program.methods
          .expire()
          .accounts({
            escrow,
            buyerWallet: buyer.publicKey,
            caller: keeper.publicKey,
          })
          .signers([keeper])
          .rpc();
        break;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await sleep(3_000);
      }
    }
    expect(await connection.getAccountInfo(escrow)).to.be.null;
  });
});
