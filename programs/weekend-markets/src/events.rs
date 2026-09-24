use anchor_lang::prelude::*;

use crate::state::{Side, VoidReason};

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub feed_id: [u8; 32],
    pub strike_price: i64,
    pub strike_expo: i32,
    pub lock_ts: i64,
    pub resolve_ts: i64,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: Side,
    pub amount: u64,
    pub yes_pool: u64,
    pub no_pool: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub outcome: Side,
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

#[event]
pub struct MarketVoided {
    pub market: Pubkey,
    pub reason: VoidReason,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}
