use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, error::MarketError, events::MarketCreated, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateMarketParams {
    pub market_id: u64,
    pub feed_id: [u8; 32],
    pub strike_price: i64,
    pub strike_expo: i32,
    pub lock_ts: i64,
    pub resolve_ts: i64,
    pub resolve_window_secs: u32,
    pub void_delay_secs: u32,
    pub max_conf_bps: u16,
}

#[derive(Accounts)]
#[instruction(params: CreateMarketParams)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, creator.key().as_ref(), &params.market_id.to_le_bytes()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,
    // Classic SPL Token only: Token-2022 transfer fees or hooks would let the
    // vault receive less than the pools record.
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = market,
        token::token_program = token_program,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn validate_params(p: &CreateMarketParams, now: i64) -> Result<()> {
    require!(p.feed_id != [0u8; 32], MarketError::InvalidFeedId);
    require!(p.strike_price > 0, MarketError::InvalidStrike);
    require!(
        (MIN_EXPO..=MAX_EXPO).contains(&p.strike_expo),
        MarketError::InvalidExponent
    );
    require!(p.lock_ts > now, MarketError::LockInPast);
    require!(p.resolve_ts >= p.lock_ts, MarketError::ResolveBeforeLock);
    require!(
        (1..=MAX_RESOLVE_WINDOW_SECS).contains(&p.resolve_window_secs),
        MarketError::InvalidResolveWindow
    );
    require!(
        (MIN_VOID_DELAY_SECS..=MAX_VOID_DELAY_SECS).contains(&p.void_delay_secs),
        MarketError::InvalidVoidDelay
    );
    require!(
        (1..=10_000).contains(&p.max_conf_bps),
        MarketError::InvalidConfidenceBound
    );
    Ok(())
}

pub fn handle_create_market(ctx: Context<CreateMarket>, params: CreateMarketParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate_params(&params, now)?;

    let market = &mut ctx.accounts.market;
    market.set_inner(Market {
        creator: ctx.accounts.creator.key(),
        market_id: params.market_id,
        collateral_mint: ctx.accounts.collateral_mint.key(),
        vault: ctx.accounts.vault.key(),
        feed_id: params.feed_id,
        strike_price: params.strike_price,
        strike_expo: params.strike_expo,
        lock_ts: params.lock_ts,
        resolve_ts: params.resolve_ts,
        resolve_window_secs: params.resolve_window_secs,
        void_delay_secs: params.void_delay_secs,
        max_conf_bps: params.max_conf_bps,
        yes_pool: 0,
        no_pool: 0,
        open_positions: 0,
        status: MarketStatus::Open,
        outcome: None,
        void_reason: None,
        settle_price: 0,
        settle_conf: 0,
        settle_expo: 0,
        settle_publish_time: 0,
        bump: ctx.bumps.market,
        vault_bump: ctx.bumps.vault,
    });

    emit!(MarketCreated {
        market: market.key(),
        creator: market.creator,
        feed_id: market.feed_id,
        strike_price: market.strike_price,
        strike_expo: market.strike_expo,
        lock_ts: market.lock_ts,
        resolve_ts: market.resolve_ts,
    });
    Ok(())
}
