use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Side {
    /// Settlement price is at or above the strike.
    Yes,
    /// Settlement price is below the strike.
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MarketStatus {
    Open,
    Resolved,
    Voided,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum VoidReason {
    /// One side had no stake, so there was no counterparty. Everyone is refunded.
    OneSidedPool,
    /// Nobody posted a valid settlement price before the void delay ran out.
    NoOraclePrice,
}

/// A binary parimutuel market: "will `feed_id` print at or above `strike` at `resolve_ts`?"
///
/// Bets are pooled per side. Winners split the whole pot pro rata to their stake;
/// there is no house, no fee and no AMM, so the market can't be insolvent.
#[account]
#[derive(InitSpace, Debug)]
pub struct Market {
    pub creator: Pubkey,
    pub market_id: u64,
    pub collateral_mint: Pubkey,
    pub vault: Pubkey,
    /// Pyth price feed id (e.g. Equity.US.NVDA/USD).
    pub feed_id: [u8; 32],
    /// Strike is `strike_price * 10^strike_expo`.
    pub strike_price: i64,
    pub strike_expo: i32,
    /// No bets at or after this time.
    pub lock_ts: i64,
    /// Settlement uses the first Pyth price published at or after this time.
    pub resolve_ts: i64,
    /// The settlement price must be published within `resolve_window_secs` of `resolve_ts`.
    pub resolve_window_secs: u32,
    /// After `resolve_ts + resolve_window_secs + void_delay_secs` an unresolved market can be voided.
    pub void_delay_secs: u32,
    /// Reject settlement prices whose confidence interval exceeds this fraction of price.
    pub max_conf_bps: u16,
    pub yes_pool: u64,
    pub no_pool: u64,
    /// Positions not yet claimed; the market can only be closed at zero.
    pub open_positions: u32,
    pub status: MarketStatus,
    pub outcome: Option<Side>,
    pub void_reason: Option<VoidReason>,
    pub settle_price: i64,
    pub settle_conf: u64,
    pub settle_expo: i32,
    pub settle_publish_time: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
    pub bump: u8,
}
