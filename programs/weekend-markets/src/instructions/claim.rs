use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::MarketError, events::Claimed, math, state::*};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = vault, has_one = collateral_mint)]
    pub market: Box<Account<'info, Market>>,
    #[account(
        mut,
        close = owner,
        seeds = [POSITION_SEED, market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = market,
    )]
    pub position: Box<Account<'info, Position>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = collateral_mint)]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Pays out a settled position and closes it, returning its rent to the owner.
/// Losing positions claim zero but still close, so the market can be cleaned up.
pub fn handle_claim(ctx: Context<Claim>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let position = &ctx.accounts.position;
    let amount = math::payout(
        market.status,
        market.outcome,
        market.yes_pool,
        market.no_pool,
        position.yes_amount,
        position.no_amount,
    )?;

    market.open_positions = market
        .open_positions
        .checked_sub(1)
        .ok_or(MarketError::MathOverflow)?;

    if amount > 0 {
        let creator = market.creator;
        let id = market.market_id.to_le_bytes();
        let seeds: &[&[u8]] = &[MARKET_SEED, creator.as_ref(), &id, &[market.bump]];
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: market.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            amount,
            ctx.accounts.collateral_mint.decimals,
        )?;
    }

    emit!(Claimed {
        market: market.key(),
        owner: ctx.accounts.owner.key(),
        amount,
    });
    Ok(())
}
