use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::MarketError, state::*};

/// Creator-only cleanup after every position has claimed: sends rounding dust
/// to the creator and reclaims rent for the vault and market accounts.
#[derive(Accounts)]
pub struct CloseMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, close = creator, has_one = creator, has_one = vault, has_one = collateral_mint)]
    pub market: Box<Account<'info, Market>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = collateral_mint)]
    pub creator_token: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_close_market(ctx: Context<CloseMarket>) -> Result<()> {
    let market = &ctx.accounts.market;
    require!(market.status != MarketStatus::Open, MarketError::MarketStillOpen);
    require!(market.open_positions == 0, MarketError::PositionsOutstanding);

    let creator = market.creator;
    let id = market.market_id.to_le_bytes();
    let seeds: &[&[u8]] = &[MARKET_SEED, creator.as_ref(), &id, &[market.bump]];

    let dust = ctx.accounts.vault.amount;
    if dust > 0 {
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.collateral_mint.to_account_info(),
                    to: ctx.accounts.creator_token.to_account_info(),
                    authority: market.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            dust,
            ctx.accounts.collateral_mint.decimals,
        )?;
    }

    token::close_account(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.creator.to_account_info(),
                authority: market.to_account_info(),
            },
        )
        .with_signer(&[seeds]),
    )?;
    Ok(())
}
