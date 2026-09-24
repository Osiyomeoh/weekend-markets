use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::MarketError, events::BetPlaced, state::*};

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,
    #[account(mut, has_one = vault, has_one = collateral_mint)]
    pub market: Box<Account<'info, Market>>,
    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, Position>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = bettor,
    )]
    pub bettor_token: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_place_bet(ctx: Context<PlaceBet>, side: Side, amount: u64) -> Result<()> {
    require!(amount > 0, MarketError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Open, MarketError::MarketNotOpen);
    require!(now < market.lock_ts, MarketError::BettingClosed);

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.bettor.key();
        position.market = market.key();
        position.bump = ctx.bumps.position;
        market.open_positions = market
            .open_positions
            .checked_add(1)
            .ok_or(MarketError::MathOverflow)?;
    }

    match side {
        Side::Yes => {
            position.yes_amount = position
                .yes_amount
                .checked_add(amount)
                .ok_or(MarketError::MathOverflow)?;
            market.yes_pool = market
                .yes_pool
                .checked_add(amount)
                .ok_or(MarketError::MathOverflow)?;
        }
        Side::No => {
            position.no_amount = position
                .no_amount
                .checked_add(amount)
                .ok_or(MarketError::MathOverflow)?;
            market.no_pool = market
                .no_pool
                .checked_add(amount)
                .ok_or(MarketError::MathOverflow)?;
        }
    }

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.bettor_token.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.bettor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    emit!(BetPlaced {
        market: market.key(),
        bettor: position.owner,
        side,
        amount,
        yes_pool: market.yes_pool,
        no_pool: market.no_pool,
    });
    Ok(())
}
