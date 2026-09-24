use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum MarketError {
    #[msg("lock_ts must be in the future")]
    LockInPast,
    #[msg("resolve_ts must be at or after lock_ts")]
    ResolveBeforeLock,
    #[msg("resolve window must be between 1 second and 1 hour")]
    InvalidResolveWindow,
    #[msg("void delay must be between 1 hour and 7 days")]
    InvalidVoidDelay,
    #[msg("max_conf_bps must be between 1 and 10000")]
    InvalidConfidenceBound,
    #[msg("strike price must be positive")]
    InvalidStrike,
    #[msg("exponent must be between -18 and 0")]
    InvalidExponent,
    #[msg("feed id must not be empty")]
    InvalidFeedId,
    #[msg("bet amount must be greater than zero")]
    ZeroAmount,
    #[msg("market is not open")]
    MarketNotOpen,
    #[msg("betting has closed for this market")]
    BettingClosed,
    #[msg("market cannot be resolved before resolve_ts")]
    TooEarlyToResolve,
    #[msg("price update is not fully verified by Wormhole guardians")]
    InsufficientVerification,
    #[msg("price update is for a different feed")]
    FeedMismatch,
    #[msg("price was published before resolve_ts")]
    PriceBeforeResolveTime,
    #[msg("price was published after the resolve window closed")]
    PriceAfterResolveWindow,
    #[msg("price is not the first update at or after resolve_ts")]
    NotFirstPriceAfterResolveTime,
    #[msg("oracle price must be positive")]
    NonPositivePrice,
    #[msg("oracle confidence interval is too wide to settle")]
    ConfidenceTooWide,
    #[msg("market cannot be voided yet")]
    TooEarlyToVoid,
    #[msg("market is still open")]
    MarketStillOpen,
    #[msg("market still has unclaimed positions")]
    PositionsOutstanding,
    #[msg("arithmetic overflow")]
    MathOverflow,
}
