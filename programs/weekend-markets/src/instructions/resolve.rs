use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};

use crate::{
    error::MarketError,
    events::{MarketResolved, MarketVoided},
    math,
    state::*,
};

/// Permissionless: anyone may settle a market by supplying the Pyth price update
/// that is the first print at or after `resolve_ts`.
#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(mut)]
    pub market: Box<Account<'info, Market>>,
    /// `Account` checks this is owned by the Pyth receiver program, so the
    /// contents were posted (and signature-checked) by Pyth, not by the caller.
    pub price_update: Box<Account<'info, PriceUpdateV2>>,
}

pub fn handle_resolve(ctx: Context<Resolve>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let market = &mut ctx.accounts.market;
    require!(market.status == MarketStatus::Open, MarketError::MarketNotOpen);
    require!(now >= market.resolve_ts, MarketError::TooEarlyToResolve);

    let update = &ctx.accounts.price_update;
    require!(
        update.verification_level == VerificationLevel::Full,
        MarketError::InsufficientVerification
    );
    let msg = &update.price_message;
    require!(msg.feed_id == market.feed_id, MarketError::FeedMismatch);
    math::check_settlement_timing(
        msg.publish_time,
        msg.prev_publish_time,
        market.resolve_ts,
        market.resolve_window_secs,
    )?;
    require!(msg.price > 0, MarketError::NonPositivePrice);
    require!(
        math::confidence_ok(msg.price, msg.conf, market.max_conf_bps),
        MarketError::ConfidenceTooWide
    );

    market.settle_price = msg.price;
    market.settle_conf = msg.conf;
    market.settle_expo = msg.exponent;
    market.settle_publish_time = msg.publish_time;

    if market.yes_pool == 0 || market.no_pool == 0 {
        market.status = MarketStatus::Voided;
        market.void_reason = Some(VoidReason::OneSidedPool);
        emit!(MarketVoided {
            market: market.key(),
            reason: VoidReason::OneSidedPool,
        });
        return Ok(());
    }

    let outcome = math::outcome_for(
        msg.price,
        msg.exponent,
        market.strike_price,
        market.strike_expo,
    )?;
    market.status = MarketStatus::Resolved;
    market.outcome = Some(outcome);

    emit!(MarketResolved {
        market: market.key(),
        outcome,
        price: msg.price,
        conf: msg.conf,
        expo: msg.exponent,
        publish_time: msg.publish_time,
    });
    Ok(())
}
