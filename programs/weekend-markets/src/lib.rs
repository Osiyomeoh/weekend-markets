//! Weekend Markets: binary parimutuel prediction markets on tokenized-stock
//! prices, settled permissionlessly by the first Pyth print at or after a
//! fixed time (e.g. Monday's 09:30 ET open).

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2oihGq9YRDQkgeEXwrzGcgs9UjDZVUKeKZCP81UkTSN9");

#[program]
pub mod weekend_markets {
    use super::*;

    pub fn create_market(ctx: Context<CreateMarket>, params: CreateMarketParams) -> Result<()> {
        instructions::create_market::handle_create_market(ctx, params)
    }

    pub fn place_bet(ctx: Context<PlaceBet>, side: Side, amount: u64) -> Result<()> {
        instructions::place_bet::handle_place_bet(ctx, side, amount)
    }

    pub fn resolve(ctx: Context<Resolve>) -> Result<()> {
        instructions::resolve::handle_resolve(ctx)
    }

    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        instructions::void_market::handle_void_market(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handle_claim(ctx)
    }

    pub fn close_market(ctx: Context<CloseMarket>) -> Result<()> {
        instructions::close_market::handle_close_market(ctx)
    }
}
