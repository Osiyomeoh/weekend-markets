use anchor_lang::prelude::*;

use crate::{error::MarketError, events::MarketVoided, state::*};

/// Permissionless: refunds everyone when a market can't settle fairly.
#[derive(Accounts)]
pub struct VoidMarket<'info> {
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
}

pub fn handle_void_market(ctx: Context<VoidMarket>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Open, MarketError::MarketNotOpen);

    // Once betting is locked with one side empty there's no counterparty, so
    // refund straight away rather than waiting for the oracle.
    let one_sided = now >= market.lock_ts && (market.yes_pool == 0 || market.no_pool == 0);

    let void_after = market
        .resolve_ts
        .checked_add(market.resolve_window_secs as i64)
        .and_then(|t| t.checked_add(market.void_delay_secs as i64))
        .ok_or(MarketError::MathOverflow)?;
    let oracle_missing = now >= void_after;

    let reason = if one_sided {
        VoidReason::OneSidedPool
    } else if oracle_missing {
        VoidReason::NoOraclePrice
    } else {
        return err!(MarketError::TooEarlyToVoid);
    };

    market.status = MarketStatus::Voided;
    market.void_reason = Some(reason);
    emit!(MarketVoided {
        market: market.key(),
        reason,
    });
    Ok(())
}
