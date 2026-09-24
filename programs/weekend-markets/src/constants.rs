pub const MARKET_SEED: &[u8] = b"market";
pub const VAULT_SEED: &[u8] = b"vault";
pub const POSITION_SEED: &[u8] = b"position";

/// Upper bound on how long after `resolve_ts` a settlement price may be published.
pub const MAX_RESOLVE_WINDOW_SECS: u32 = 3_600;

/// Bounds on how long winners have to post a settlement price before anyone
/// may void the market. The floor keeps a losing side from voiding a market
/// before the winning side has had a fair chance to resolve it.
pub const MIN_VOID_DELAY_SECS: u32 = 3_600;
pub const MAX_VOID_DELAY_SECS: u32 = 7 * 24 * 3_600;

/// Pyth exponents are small negative numbers (e.g. -5, -8). Strikes use the
/// same representation; anything outside this range is rejected.
pub const MIN_EXPO: i32 = -18;
pub const MAX_EXPO: i32 = 0;

pub const BPS_DENOMINATOR: u128 = 10_000;
