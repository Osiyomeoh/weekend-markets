//! Pure settlement math, kept free of account types so it can be unit-tested directly.

use core::cmp::Ordering;

use crate::{
    constants::BPS_DENOMINATOR,
    error::MarketError,
    state::{MarketStatus, Side},
};

/// Compares `price * 10^expo` with `strike * 10^strike_expo` exactly, by scaling
/// the value with the larger exponent down to the smaller one in i128.
pub fn compare_to_strike(
    price: i64,
    expo: i32,
    strike: i64,
    strike_expo: i32,
) -> Result<Ordering, MarketError> {
    let (mut a, mut b) = (price as i128, strike as i128);
    let diff = expo.checked_sub(strike_expo).ok_or(MarketError::MathOverflow)?;
    let scale = 10i128
        .checked_pow(diff.unsigned_abs())
        .ok_or(MarketError::MathOverflow)?;
    if diff > 0 {
        a = a.checked_mul(scale).ok_or(MarketError::MathOverflow)?;
    } else if diff < 0 {
        b = b.checked_mul(scale).ok_or(MarketError::MathOverflow)?;
    }
    Ok(a.cmp(&b))
}

/// At or above the strike settles YES; strictly below settles NO.
pub fn outcome_for(
    price: i64,
    expo: i32,
    strike: i64,
    strike_expo: i32,
) -> Result<Side, MarketError> {
    Ok(match compare_to_strike(price, expo, strike, strike_expo)? {
        Ordering::Less => Side::No,
        Ordering::Equal | Ordering::Greater => Side::Yes,
    })
}

/// True when `conf / price <= max_conf_bps / 10_000`. Requires `price > 0`.
pub fn confidence_ok(price: i64, conf: u64, max_conf_bps: u16) -> bool {
    if price <= 0 {
        return false;
    }
    (conf as u128) * BPS_DENOMINATOR <= (price as u128) * (max_conf_bps as u128)
}

/// Checks that a Pyth update is *the* settlement price: published inside
/// `[resolve_ts, resolve_ts + window]`, and the first one at or after `resolve_ts`
/// (its predecessor was published strictly before `resolve_ts`). The second
/// condition stops a resolver from picking whichever price in the window suits them.
pub fn check_settlement_timing(
    publish_time: i64,
    prev_publish_time: i64,
    resolve_ts: i64,
    window_secs: u32,
) -> Result<(), MarketError> {
    if publish_time < resolve_ts {
        return Err(MarketError::PriceBeforeResolveTime);
    }
    let window_end = resolve_ts
        .checked_add(window_secs as i64)
        .ok_or(MarketError::MathOverflow)?;
    if publish_time > window_end {
        return Err(MarketError::PriceAfterResolveWindow);
    }
    if prev_publish_time >= resolve_ts {
        return Err(MarketError::NotFirstPriceAfterResolveTime);
    }
    Ok(())
}

/// Amount owed to a position once the market has settled.
///
/// Resolved: winners get `stake * (yes_pool + no_pool) / winning_pool`, rounded
/// down, so the sum of payouts never exceeds the vault. Losers get nothing.
/// Voided: every position gets its full stake back.
pub fn payout(
    status: MarketStatus,
    outcome: Option<Side>,
    yes_pool: u64,
    no_pool: u64,
    yes_amount: u64,
    no_amount: u64,
) -> Result<u64, MarketError> {
    match status {
        MarketStatus::Open => Err(MarketError::MarketStillOpen),
        MarketStatus::Voided => yes_amount
            .checked_add(no_amount)
            .ok_or(MarketError::MathOverflow),
        MarketStatus::Resolved => {
            let (stake, winning_pool) = match outcome {
                Some(Side::Yes) => (yes_amount, yes_pool),
                Some(Side::No) => (no_amount, no_pool),
                None => return Err(MarketError::MarketStillOpen),
            };
            if stake == 0 {
                return Ok(0);
            }
            // resolve() voids one-sided pools, so winning_pool > 0 whenever stake > 0.
            let total = (yes_pool as u128) + (no_pool as u128);
            let owed = (stake as u128)
                .checked_mul(total)
                .ok_or(MarketError::MathOverflow)?
                / (winning_pool as u128);
            u64::try_from(owed).map_err(|_| MarketError::MathOverflow)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_same_exponent() {
        assert_eq!(compare_to_strike(100, -2, 100, -2).unwrap(), Ordering::Equal);
        assert_eq!(compare_to_strike(99, -2, 100, -2).unwrap(), Ordering::Less);
        assert_eq!(compare_to_strike(101, -2, 100, -2).unwrap(), Ordering::Greater);
    }

    #[test]
    fn compare_across_exponents() {
        // $180.00000 (expo -5) vs $180.00 (expo -2)
        assert_eq!(
            compare_to_strike(18_000_000, -5, 18_000, -2).unwrap(),
            Ordering::Equal
        );
        // $179.99999 is below $180.00
        assert_eq!(
            compare_to_strike(17_999_999, -5, 18_000, -2).unwrap(),
            Ordering::Less
        );
        // strike has the finer exponent
        assert_eq!(
            compare_to_strike(18_001, -2, 18_000_000, -5).unwrap(),
            Ordering::Greater
        );
    }

    #[test]
    fn compare_extreme_values_do_not_overflow() {
        assert_eq!(
            compare_to_strike(i64::MAX, 0, 1, -18).unwrap(),
            Ordering::Greater
        );
        assert_eq!(
            compare_to_strike(1, -18, i64::MAX, 0).unwrap(),
            Ordering::Less
        );
    }

    #[test]
    fn tie_settles_yes() {
        assert_eq!(outcome_for(18_000, -2, 18_000, -2).unwrap(), Side::Yes);
        assert_eq!(outcome_for(17_999, -2, 18_000, -2).unwrap(), Side::No);
    }

    #[test]
    fn confidence_bounds() {
        // conf 0.5% of price, limit 1%
        assert!(confidence_ok(10_000, 50, 100));
        // exactly at limit
        assert!(confidence_ok(10_000, 100, 100));
        // just over
        assert!(!confidence_ok(10_000, 101, 100));
        assert!(!confidence_ok(0, 0, 100));
        assert!(!confidence_ok(-5, 0, 100));
        // no overflow at extremes
        assert!(confidence_ok(i64::MAX, u64::MAX / 10_000, 10_000));
    }

    #[test]
    fn settlement_timing() {
        let t = 1_000;
        assert!(check_settlement_timing(1_000, 990, t, 60).is_ok());
        assert!(check_settlement_timing(1_060, 999, t, 60).is_ok());
        assert_eq!(
            check_settlement_timing(999, 990, t, 60),
            Err(MarketError::PriceBeforeResolveTime)
        );
        assert_eq!(
            check_settlement_timing(1_061, 999, t, 60),
            Err(MarketError::PriceAfterResolveWindow)
        );
        // a later update in the window whose predecessor was already >= resolve_ts
        assert_eq!(
            check_settlement_timing(1_005, 1_000, t, 60),
            Err(MarketError::NotFirstPriceAfterResolveTime)
        );
    }

    #[test]
    fn payout_splits_pot_pro_rata() {
        // yes 300 (alice 100, bob 200), no 600
        let r = MarketStatus::Resolved;
        assert_eq!(payout(r, Some(Side::Yes), 300, 600, 100, 0).unwrap(), 300);
        assert_eq!(payout(r, Some(Side::Yes), 300, 600, 200, 0).unwrap(), 600);
        assert_eq!(payout(r, Some(Side::Yes), 300, 600, 0, 600).unwrap(), 0);
    }

    #[test]
    fn payout_rounds_down_and_never_exceeds_pot() {
        // three equal winners splitting a pot that doesn't divide evenly
        let (yes, no) = (3u64, 7u64);
        let each = payout(MarketStatus::Resolved, Some(Side::Yes), yes, no, 1, 0).unwrap();
        assert_eq!(each, 3); // 10/3 = 3.33 -> 3
        assert!(each * 3 <= yes + no);
    }

    #[test]
    fn payout_hedged_position_only_counts_winning_side() {
        let r = MarketStatus::Resolved;
        assert_eq!(payout(r, Some(Side::No), 100, 100, 50, 50).unwrap(), 100);
    }

    #[test]
    fn payout_voided_refunds_everything() {
        assert_eq!(
            payout(MarketStatus::Voided, None, 10, 0, 7, 3).unwrap(),
            10
        );
    }

    #[test]
    fn payout_rejects_open_market() {
        assert_eq!(
            payout(MarketStatus::Open, None, 1, 1, 1, 0),
            Err(MarketError::MarketStillOpen)
        );
    }

    #[test]
    fn payout_large_pools_no_overflow() {
        let big = u64::MAX / 2;
        assert_eq!(
            payout(MarketStatus::Resolved, Some(Side::Yes), big, big, big, 0).unwrap(),
            big * 2
        );
    }
}
