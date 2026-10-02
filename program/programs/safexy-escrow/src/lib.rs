use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("3XtS8x4cttGfBK2QhbqKpbVDnon4eeQembPbxpjvtL63");

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const CONFIG_SEED: &[u8] = b"config";

/// Fee charged on a released lamport amount, rounded up to the lamport.
/// fee = ceil(gross * fee_bps / 10_000). For 1%: 1000 SOL -> 10 SOL.
pub fn fee_for(gross: u64, fee_bps: u64) -> Result<u64> {
    if gross == 0 || fee_bps == 0 {
        return Ok(0);
    }
    let num = (gross as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(EscrowError::Overflow)?;
    Ok(((num + BPS_DENOMINATOR as u128 - 1) / BPS_DENOMINATOR as u128) as u64)
}

#[program]
pub mod safexy_escrow {
    use super::*;

    /// One-time setup: creates the protocol config PDA (platform wallet,
    /// keeper, fee and deadline windows). `authority` can update it later.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        platform: Pubkey,
        keeper: Pubkey,
        fee_bps: u64,
        acceptance_window: i64,
        dispute_window: i64,
        min_deposit: u64,
    ) -> Result<()> {
        require!(fee_bps <= BPS_DENOMINATOR, EscrowError::InvalidFeeBps);
        require!(acceptance_window > 0, EscrowError::InvalidWindow);
        require!(
            dispute_window > acceptance_window,
            EscrowError::InvalidWindow
        );
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.platform = platform;
        config.keeper = keeper;
        config.fee_bps = fee_bps;
        config.acceptance_window = acceptance_window;
        config.dispute_window = dispute_window;
        config.min_deposit = min_deposit;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Authority-only update of the protocol parameters / wallets.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        platform: Pubkey,
        keeper: Pubkey,
        fee_bps: u64,
        acceptance_window: i64,
        dispute_window: i64,
        min_deposit: u64,
    ) -> Result<()> {
        require!(fee_bps <= BPS_DENOMINATOR, EscrowError::InvalidFeeBps);
        require!(acceptance_window > 0, EscrowError::InvalidWindow);
        require!(
            dispute_window > acceptance_window,
            EscrowError::InvalidWindow
        );
        let config = &mut ctx.accounts.config;
        config.platform = platform;
        config.keeper = keeper;
        config.fee_bps = fee_bps;
        config.acceptance_window = acceptance_window;
        config.dispute_window = dispute_window;
        config.min_deposit = min_deposit;
        Ok(())
    }

    /// User A (`buyer`) locks `amount` lamports for `seller` (user B).
    /// The escrow PDA itself holds the funds; its data records the deadlines
    /// computed from the config windows at deposit time.
    pub fn deposit(ctx: Context<Deposit>, escrow_id: u64, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(amount >= config.min_deposit, EscrowError::BelowMinDeposit);
        require!(
            ctx.accounts.buyer.key() != ctx.accounts.seller.key(),
            EscrowError::SameParty
        );

        let now = Clock::get()?.unix_timestamp;
        {
            let escrow = &mut ctx.accounts.escrow;
            escrow.buyer = ctx.accounts.buyer.key();
            escrow.seller = ctx.accounts.seller.key();
            escrow.escrow_id = escrow_id;
            escrow.amount = amount;
            escrow.created_at = now;
            escrow.acceptance_deadline = now
                .checked_add(config.acceptance_window)
                .ok_or(EscrowError::Overflow)?;
            escrow.dispute_deadline = now
                .checked_add(config.dispute_window)
                .ok_or(EscrowError::Overflow)?;
            escrow.state = EscrowState::Created;
            escrow.counter_offer_amount = 0;
            escrow.fee_bps = config.fee_bps;
            escrow.bump = ctx.bumps.escrow;
        }

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )?;
        let escrow = &ctx.accounts.escrow;

        emit!(EscrowEvent {
            escrow: escrow.key(),
            action: Action::Deposit,
            actor: ctx.accounts.buyer.key(),
            amount,
            timestamp: now,
        });
        Ok(())
    }

    /// User B (`seller`) accepts the escrow before the 48h acceptance deadline.
    pub fn accept(ctx: Context<Accept>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Created,
            EscrowError::InvalidState
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now <= escrow.acceptance_deadline,
            EscrowError::AcceptanceDeadlinePassed
        );
        escrow.state = EscrowState::Accepted;
        emit!(EscrowEvent {
            escrow: escrow.key(),
            action: Action::Accept,
            actor: ctx.accounts.seller.key(),
            amount: escrow.amount,
            timestamp: now,
        });
        Ok(())
    }

    /// B proposes to receive `seller_amount` instead of the full amount.
    /// The difference goes back to A on release.
    pub fn counter_offer(ctx: Context<CounterOffer>, seller_amount: u64) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Accepted,
            EscrowError::InvalidState
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now <= escrow.dispute_deadline, EscrowError::DisputeDeadlinePassed);
        require!(seller_amount > 0, EscrowError::InvalidAmount);
        require!(seller_amount <= escrow.amount, EscrowError::InvalidAmount);
        escrow.state = EscrowState::CounterOffer;
        escrow.counter_offer_amount = seller_amount;
        emit!(EscrowEvent {
            escrow: escrow.key(),
            action: Action::CounterOffer,
            actor: ctx.accounts.seller.key(),
            amount: seller_amount,
            timestamp: now,
        });
        Ok(())
    }

    /// A rejects B's counteroffer; the escrow goes back to `Accepted`.
    pub fn reject_counter_offer(ctx: Context<RejectCounterOffer>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::CounterOffer,
            EscrowError::InvalidState
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now <= escrow.dispute_deadline, EscrowError::DisputeDeadlinePassed);
        escrow.state = EscrowState::Accepted;
        escrow.counter_offer_amount = 0;
        emit!(EscrowEvent {
            escrow: escrow.key(),
            action: Action::RejectCounterOffer,
            actor: ctx.accounts.buyer.key(),
            amount: escrow.amount,
            timestamp: now,
        });
        Ok(())
    }

    /// Mutual release: A and B must both sign.
    /// - state `Accepted`: B gets `amount - fee`, platform gets `fee`.
    /// - state `CounterOffer(x)`: B gets `x - fee`, platform gets `fee`,
    ///   A gets the remaining `amount - x`.
    /// The program itself moves the lamports, so the 1% split is enforced
    /// on-chain: no trust in the transaction builder is needed.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let now = Clock::get()?.unix_timestamp;
        require!(now <= escrow.dispute_deadline, EscrowError::DisputeDeadlinePassed);

        let locked = escrow.amount;
        let gross = match escrow.state {
            EscrowState::Accepted => locked,
            EscrowState::CounterOffer => escrow.counter_offer_amount,
            _ => return err!(EscrowError::NotAccepted),
        };
        let fee = fee_for(gross, escrow.fee_bps)?;
        let to_seller = gross.checked_sub(fee).ok_or(EscrowError::Overflow)?;
        let to_buyer = locked.checked_sub(gross).ok_or(EscrowError::Overflow)?;

        let escrow_info = ctx.accounts.escrow.to_account_info();
        move_lamports(&escrow_info, &ctx.accounts.seller.to_account_info(), to_seller)?;
        move_lamports(&escrow_info, &ctx.accounts.platform.to_account_info(), fee)?;
        move_lamports(&escrow_info, &ctx.accounts.buyer.to_account_info(), to_buyer)?;

        emit!(EscrowEvent {
            escrow: escrow.key(),
            action: Action::Release,
            actor: ctx.accounts.buyer.key(),
            amount: gross,
            timestamp: now,
        });
        Ok(())
        // `close = buyer` in the accounts struct returns the rent lamports to A.
    }

    /// A takes the full deposit back: any time while `Created` (B never
    /// accepted), or after the 60-day dispute deadline in any other state.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let now = Clock::get()?.unix_timestamp;
        match escrow.state {
            EscrowState::Created => {}
            _ => require!(now > escrow.dispute_deadline, EscrowError::TooEarly),
        }

        move_lamports(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            escrow.amount,
        )?;

        emit!(EscrowEvent {
            escrow: escrow.key(),
            action: Action::Refund,
            actor: ctx.accounts.buyer.key(),
            amount: escrow.amount,
            timestamp: now,
        });
        Ok(())
    }

    /// Deadline passed: anyone (the keeper bot, A, or any crank caller) can
    /// trigger it — the funds can only go back to A, so it is safe to be
    /// permissionless. `Created` expires after the 48h acceptance deadline;
    /// every other live state expires after the 60-day dispute deadline.
    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let now = Clock::get()?.unix_timestamp;
        match escrow.state {
            EscrowState::Created => require!(
                now > escrow.acceptance_deadline,
                EscrowError::TooEarly
            ),
            EscrowState::Accepted | EscrowState::CounterOffer => require!(
                now > escrow.dispute_deadline,
                EscrowError::TooEarly
            ),
            _ => return err!(EscrowError::InvalidState),
        }

        move_lamports(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.buyer_wallet.to_account_info(),
            escrow.amount,
        )?;

        emit!(EscrowEvent {
            escrow: escrow.key(),
            action: Action::Expire,
            actor: ctx.accounts.caller.key(),
            amount: escrow.amount,
            timestamp: now,
        });
        Ok(())
    }
}

/// Moves `amount` lamports between two accounts owned correctly:
/// `from` is the escrow PDA (program-owned), `to` any account.
fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let mut from_lamports = from.try_borrow_mut_lamports()?;
    let mut to_lamports = to.try_borrow_mut_lamports()?;
    **from_lamports = (**from_lamports)
        .checked_sub(amount)
        .ok_or(EscrowError::Overflow)?;
    **to_lamports = (**to_lamports)
        .checked_add(amount)
        .ok_or(EscrowError::Overflow)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct Deposit<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: seller only signs later (on accept); no constraint needed here.
    pub seller: UncheckedAccount<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [ESCROW_SEED, buyer.key().as_ref(), &escrow_id.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Accept<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = seller,
    )]
    pub escrow: Account<'info, Escrow>,
    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct CounterOffer<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = seller,
    )]
    pub escrow: Account<'info, Escrow>,
    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct RejectCounterOffer<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    pub buyer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// CHECK: the platform wallet is pinned by the stored config.
    #[account(
        mut,
        constraint = platform.key() == config.platform @ EscrowError::WrongPlatform
    )]
    pub platform: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = buyer,
        has_one = seller,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: receives the release payout; only needs to exist as a system
    /// account destination. Verified against the escrow data.
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = buyer,
        close = buyer,
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub buyer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Expire<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.buyer.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        close = buyer_wallet,
    )]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: receives the refund + rent. Verified against the escrow data.
    #[account(mut, constraint = buyer_wallet.key() == escrow.buyer @ EscrowError::WrongBuyer)]
    pub buyer_wallet: UncheckedAccount<'info>,
    /// Keeper, A, or anyone else — the payout destination is fixed to A.
    pub caller: Signer<'info>,
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub platform: Pubkey,
    pub keeper: Pubkey,
    pub fee_bps: u64,
    pub acceptance_window: i64,
    pub dispute_window: i64,
    pub min_deposit: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    /// User A — deposits, and receives refunds / expiry payouts.
    pub buyer: Pubkey,
    /// User B — accepts, and receives the release minus the platform fee.
    pub seller: Pubkey,
    pub escrow_id: u64,
    /// Locked lamports (excludes rent).
    pub amount: u64,
    /// Unix seconds.
    pub created_at: i64,
    pub acceptance_deadline: i64,
    pub dispute_deadline: i64,
    pub state: EscrowState,
    /// Valid while state == CounterOffer: gross amount B proposed for himself.
    pub counter_offer_amount: u64,
    /// Snapshot of the config fee at deposit time.
    pub fee_bps: u64,
    pub bump: u8,
}

/// On-chain lifecycle. The first three variants are the live states stored in
/// the account; `Released` / `Refunded` / `Expired` are terminal — on Solana
/// they are reached by closing the escrow account, and are surfaced through
/// events instead of stored data.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowState {
    Created,
    Accepted,
    CounterOffer,
    Released,
    Refunded,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum Action {
    Deposit,
    Accept,
    CounterOffer,
    RejectCounterOffer,
    Release,
    Refund,
    Expire,
}

#[event]
pub struct EscrowEvent {
    pub escrow: Pubkey,
    pub action: Action,
    pub actor: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum EscrowError {
    #[msg("Fee must be <= 10000 bps")]
    InvalidFeeBps,
    #[msg("Invalid deadline window")]
    InvalidWindow,
    #[msg("Deposit below the configured minimum")]
    BelowMinDeposit,
    #[msg("Buyer and seller must differ")]
    SameParty,
    #[msg("Invalid escrow state for this action")]
    InvalidState,
    #[msg("The 48h acceptance deadline has passed")]
    AcceptanceDeadlinePassed,
    #[msg("The 60-day dispute deadline has passed")]
    DisputeDeadlinePassed,
    #[msg("Deadline has not been reached yet")]
    TooEarly,
    #[msg("Escrow was never accepted")]
    NotAccepted,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Platform account does not match the config")]
    WrongPlatform,
    #[msg("Buyer account does not match the escrow")]
    WrongBuyer,
    #[msg("Math overflow")]
    Overflow,
}
