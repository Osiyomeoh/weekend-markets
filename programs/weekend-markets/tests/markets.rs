mod common;

use {
    anchor_lang::error::ErrorCode as AnchorError,
    common::*,
    pyth_solana_receiver_sdk::price_update::VerificationLevel,
    solana_signer::Signer,
    weekend_markets::{error::MarketError, MarketStatus, Side, VoidReason},
};

// ---------------------------------------------------------------- create_market

#[test]
fn create_market_initializes_state() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    let m = env.market(&market);

    assert_eq!(m.creator, env.creator.kp.pubkey());
    assert_eq!(m.market_id, 1);
    assert_eq!(m.collateral_mint, env.mint);
    assert_eq!(m.vault, env.vault_pda(&market));
    assert_eq!(m.feed_id, FEED);
    assert_eq!((m.strike_price, m.strike_expo), (STRIKE, STRIKE_EXPO));
    assert_eq!((m.lock_ts, m.resolve_ts), (LOCK, RESOLVE));
    assert_eq!(m.status, MarketStatus::Open);
    assert_eq!((m.yes_pool, m.no_pool, m.open_positions), (0, 0, 0));
    assert_eq!(m.outcome, None);
    assert_eq!(env.balance(&m.vault), 0);
}

#[test]
fn create_market_rejects_invalid_params() {
    let mut env = Env::new();
    type Mutate = fn(&mut weekend_markets::CreateMarketParams);
    let cases: Vec<(&str, Mutate, MarketError)> = vec![
        ("empty feed", |p| p.feed_id = [0; 32], MarketError::InvalidFeedId),
        ("zero strike", |p| p.strike_price = 0, MarketError::InvalidStrike),
        ("negative strike", |p| p.strike_price = -1, MarketError::InvalidStrike),
        ("positive expo", |p| p.strike_expo = 1, MarketError::InvalidExponent),
        ("expo too small", |p| p.strike_expo = -19, MarketError::InvalidExponent),
        ("lock in past", |p| p.lock_ts = T0, MarketError::LockInPast),
        ("resolve before lock", |p| p.resolve_ts = LOCK - 1, MarketError::ResolveBeforeLock),
        ("zero window", |p| p.resolve_window_secs = 0, MarketError::InvalidResolveWindow),
        ("window too long", |p| p.resolve_window_secs = 3_601, MarketError::InvalidResolveWindow),
        ("void delay too short", |p| p.void_delay_secs = 3_599, MarketError::InvalidVoidDelay),
        ("void delay too long", |p| p.void_delay_secs = 7 * 24 * 3_600 + 1, MarketError::InvalidVoidDelay),
        ("zero conf bound", |p| p.max_conf_bps = 0, MarketError::InvalidConfidenceBound),
        ("conf bound over 100%", |p| p.max_conf_bps = 10_001, MarketError::InvalidConfidenceBound),
    ];
    let creator = env.creator.kp.insecure_clone();
    for (i, (name, mutate, expected)) in cases.into_iter().enumerate() {
        let mut params = default_params(100 + i as u64);
        mutate(&mut params);
        let ix = env.ix_create_market(&creator.pubkey(), params);
        let res = env.send(&[ix], &[&creator]);
        assert!(res.is_err(), "case '{name}' should fail");
        assert_market_error(res, expected);
    }
}

#[test]
fn create_market_same_id_twice_fails() {
    let mut env = Env::new();
    env.create_market(default_params(1));
    let creator = env.creator.kp.insecure_clone();
    let ix = env.ix_create_market(&creator.pubkey(), default_params(1));
    assert!(env.send(&[ix], &[&creator]).is_err());
}

// ------------------------------------------------------------------ place_bet

#[test]
fn place_bet_moves_funds_and_tracks_pools() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));

    env.bet(&market, Who::Alice, Side::Yes, 100).unwrap();
    env.bet(&market, Who::Bob, Side::No, 300).unwrap();
    env.bet(&market, Who::Alice, Side::Yes, 50).unwrap();
    env.bet(&market, Who::Alice, Side::No, 5).unwrap();

    let m = env.market(&market);
    assert_eq!((m.yes_pool, m.no_pool), (150, 305));
    assert_eq!(m.open_positions, 2, "repeat bets reuse the position");
    assert_eq!(env.balance(&m.vault), 455);
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE - 155);

    let alice = env.position(&market, &env.alice.kp.pubkey()).unwrap();
    assert_eq!((alice.yes_amount, alice.no_amount), (150, 5));
    assert_eq!(alice.owner, env.alice.kp.pubkey());
    assert_eq!(alice.market, market);
}

#[test]
fn place_bet_rejects_zero_amount() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    assert_market_error(env.bet(&market, Who::Alice, Side::Yes, 0), MarketError::ZeroAmount);
}

#[test]
fn place_bet_rejects_bets_at_or_after_lock() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    env.set_time(LOCK - 1);
    env.bet(&market, Who::Alice, Side::Yes, 10).unwrap();
    env.set_time(LOCK);
    assert_market_error(env.bet(&market, Who::Bob, Side::No, 10), MarketError::BettingClosed);
}

#[test]
fn place_bet_rejects_more_than_balance() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    assert!(env
        .bet(&market, Who::Alice, Side::Yes, STARTING_BALANCE + 1)
        .is_err());
    assert_eq!(env.market(&market).yes_pool, 0);
}

#[test]
fn place_bet_rejects_wrong_vault_and_foreign_token_account() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    let other = env.create_market(default_params(2));
    let (alice, alice_ata) = env.user(Who::Alice);

    // Vault belonging to a different market.
    let mut ix = env.ix_place_bet(&market, &alice.pubkey(), &alice_ata, Side::Yes, 10);
    ix.accounts[5].pubkey = env.vault_pda(&other);
    assert_anchor_error(env.send(&[ix], &[&alice]), AnchorError::ConstraintHasOne);

    // Paying from Bob's token account.
    let ix = env.ix_place_bet(&market, &alice.pubkey(), &env.bob.ata, Side::Yes, 10);
    assert_anchor_error(env.send(&[ix], &[&alice]), AnchorError::ConstraintTokenOwner);
}

// -------------------------------------------------------------------- resolve

/// Alice 100 YES, Bob 200 YES, Carol 600 NO.
fn seeded_market(env: &mut Env, id: u64) -> anchor_lang::prelude::Pubkey {
    let market = env.create_market(default_params(id));
    env.bet(&market, Who::Alice, Side::Yes, 100).unwrap();
    env.bet(&market, Who::Bob, Side::Yes, 200).unwrap();
    env.bet(&market, Who::Carol, Side::No, 600).unwrap();
    market
}

#[test]
fn full_lifecycle_yes_wins_pays_pro_rata_and_closes() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);

    env.set_time(RESOLVE + 5);
    let price = env.price(PriceSpec::default()); // $180.50 >= $180.00
    env.resolve(&market, &price).unwrap();

    let m = env.market(&market);
    assert_eq!(m.status, MarketStatus::Resolved);
    assert_eq!(m.outcome, Some(Side::Yes));
    assert_eq!((m.settle_price, m.settle_expo), (18_050_000, -5));
    assert_eq!(m.settle_publish_time, RESOLVE);

    env.claim(&market, Who::Alice).unwrap();
    env.claim(&market, Who::Bob).unwrap();
    env.claim(&market, Who::Carol).unwrap();

    // Pot is 900: Alice holds 1/3 of YES, Bob 2/3.
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE - 100 + 300);
    assert_eq!(env.balance(&env.bob.ata), STARTING_BALANCE - 200 + 600);
    assert_eq!(env.balance(&env.carol.ata), STARTING_BALANCE - 600);
    assert_eq!(env.balance(&m.vault), 0);
    assert_eq!(env.market(&market).open_positions, 0);
    assert!(env.position(&market, &env.carol.kp.pubkey()).is_none(), "loser position closed");

    env.close_market(&market).unwrap();
    assert!(!env.exists(&market));
    assert!(!env.exists(&m.vault));
}

#[test]
fn no_outcome_when_price_below_strike() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    let price = env.price(PriceSpec {
        price: 17_999_999, // $179.99999
        ..Default::default()
    });
    env.resolve(&market, &price).unwrap();
    assert_eq!(env.market(&market).outcome, Some(Side::No));

    env.claim(&market, Who::Carol).unwrap();
    assert_eq!(env.balance(&env.carol.ata), STARTING_BALANCE - 600 + 900);
    env.claim(&market, Who::Alice).unwrap();
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE - 100);
}

#[test]
fn price_exactly_at_strike_settles_yes() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    let price = env.price(PriceSpec {
        price: 18_000_000, // exactly $180.00 at a different exponent
        ..Default::default()
    });
    env.resolve(&market, &price).unwrap();
    assert_eq!(env.market(&market).outcome, Some(Side::Yes));
}

#[test]
fn resolve_rejects_invalid_price_updates() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);

    // Before resolve_ts, even with an otherwise valid update.
    env.set_time(RESOLVE - 1);
    let good = env.price(PriceSpec::default());
    assert_market_error(env.resolve(&market, &good), MarketError::TooEarlyToResolve);

    env.set_time(RESOLVE + 30);
    let cases: Vec<(&str, PriceSpec, MarketError)> = vec![
        (
            "different feed",
            PriceSpec { feed_id: [9; 32], ..Default::default() },
            MarketError::FeedMismatch,
        ),
        (
            "published before resolve_ts (stale)",
            PriceSpec {
                publish_time: RESOLVE - 1,
                prev_publish_time: RESOLVE - 2,
                ..Default::default()
            },
            MarketError::PriceBeforeResolveTime,
        ),
        (
            "published after the window",
            PriceSpec {
                publish_time: RESOLVE + WINDOW as i64 + 1,
                prev_publish_time: RESOLVE - 1,
                ..Default::default()
            },
            MarketError::PriceAfterResolveWindow,
        ),
        (
            "cherry-picked later print",
            PriceSpec {
                publish_time: RESOLVE + 10,
                prev_publish_time: RESOLVE + 9,
                ..Default::default()
            },
            MarketError::NotFirstPriceAfterResolveTime,
        ),
        (
            "partially verified",
            PriceSpec {
                verification: VerificationLevel::Partial { num_signatures: 5 },
                ..Default::default()
            },
            MarketError::InsufficientVerification,
        ),
        (
            "confidence too wide",
            PriceSpec { conf: 180_501, ..Default::default() }, // just over 1% of $180.50
            MarketError::ConfidenceTooWide,
        ),
        (
            "zero price",
            PriceSpec { price: 0, conf: 0, ..Default::default() },
            MarketError::NonPositivePrice,
        ),
        (
            "negative price",
            PriceSpec { price: -1, conf: 0, ..Default::default() },
            MarketError::NonPositivePrice,
        ),
    ];
    for (name, spec, expected) in cases {
        let update = env.price(spec);
        let res = env.resolve(&market, &update);
        assert!(res.is_err(), "case '{name}' should fail");
        assert_market_error(res, expected);
    }
    assert_eq!(env.market(&market).status, MarketStatus::Open);
}

#[test]
fn resolve_rejects_forged_price_account() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    // Byte-identical to a real update, but not owned by the Pyth receiver.
    let forged = env.put_price_update(
        anchor_lang::prelude::Pubkey::new_unique(),
        PriceSpec::default().build(),
    );
    assert_anchor_error(env.resolve(&market, &forged), AnchorError::AccountOwnedByWrongProgram);
}

#[test]
fn resolve_twice_fails() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    let yes = env.price(PriceSpec::default());
    env.resolve(&market, &yes).unwrap();
    let no = env.price(PriceSpec { price: 1, conf: 0, ..Default::default() });
    assert_market_error(env.resolve(&market, &no), MarketError::MarketNotOpen);
    assert_eq!(env.market(&market).outcome, Some(Side::Yes));
}

#[test]
fn resolve_with_one_sided_pool_voids_and_refunds() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    env.bet(&market, Who::Alice, Side::Yes, 100).unwrap();
    env.bet(&market, Who::Bob, Side::Yes, 40).unwrap();

    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&market, &price).unwrap();
    let m = env.market(&market);
    assert_eq!(m.status, MarketStatus::Voided);
    assert_eq!(m.void_reason, Some(VoidReason::OneSidedPool));

    env.claim(&market, Who::Alice).unwrap();
    env.claim(&market, Who::Bob).unwrap();
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE);
    assert_eq!(env.balance(&env.bob.ata), STARTING_BALANCE);
}

#[test]
fn resolve_empty_market_voids() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&market, &price).unwrap();
    assert_eq!(env.market(&market).status, MarketStatus::Voided);
    env.close_market(&market).unwrap();
    assert!(!env.exists(&market));
}

// ---------------------------------------------------------------- void_market

#[test]
fn void_one_sided_market_right_after_lock() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    env.bet(&market, Who::Alice, Side::No, 75).unwrap();

    env.set_time(LOCK - 1);
    assert_market_error(env.void(&market), MarketError::TooEarlyToVoid);

    env.set_time(LOCK);
    env.void(&market).unwrap();
    assert_eq!(env.market(&market).void_reason, Some(VoidReason::OneSidedPool));
    env.claim(&market, Who::Alice).unwrap();
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE);
}

#[test]
fn void_when_no_oracle_price_is_posted_in_time() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    let void_after = RESOLVE + WINDOW as i64 + VOID_DELAY as i64;

    env.set_time(void_after - 1);
    assert_market_error(env.void(&market), MarketError::TooEarlyToVoid);

    env.set_time(void_after);
    env.void(&market).unwrap();
    let m = env.market(&market);
    assert_eq!(m.status, MarketStatus::Voided);
    assert_eq!(m.void_reason, Some(VoidReason::NoOraclePrice));

    for who in [Who::Alice, Who::Bob, Who::Carol] {
        env.claim(&market, who).unwrap();
    }
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE);
    assert_eq!(env.balance(&env.bob.ata), STARTING_BALANCE);
    assert_eq!(env.balance(&env.carol.ata), STARTING_BALANCE);
    assert_eq!(env.balance(&m.vault), 0);
}

#[test]
fn resolved_market_cannot_be_voided_and_voided_cannot_be_resolved() {
    let mut env = Env::new();
    let resolved = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&resolved, &price).unwrap();
    env.set_time(RESOLVE + 10 * 24 * 3_600);
    assert_market_error(env.void(&resolved), MarketError::MarketNotOpen);

    let mut env = Env::new();
    let voided = seeded_market(&mut env, 1);
    env.set_time(RESOLVE + WINDOW as i64 + VOID_DELAY as i64);
    env.void(&voided).unwrap();
    let price = env.price(PriceSpec::default());
    assert_market_error(env.resolve(&voided, &price), MarketError::MarketNotOpen);
}

// ---------------------------------------------------------------------- claim

#[test]
fn claim_before_settlement_fails() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    assert_market_error(env.claim(&market, Who::Alice), MarketError::MarketStillOpen);
}

#[test]
fn claim_twice_fails() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&market, &price).unwrap();
    env.claim(&market, Who::Alice).unwrap();
    assert_anchor_error(env.claim(&market, Who::Alice), AnchorError::AccountNotInitialized);
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE - 100 + 300);
}

#[test]
fn cannot_claim_someone_elses_position() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&market, &price).unwrap();

    let (carol, carol_ata) = env.user(Who::Carol);
    let mut ix = env.ix_claim(&market, &carol.pubkey(), &carol_ata);
    ix.accounts[2].pubkey = env.position_pda(&market, &env.alice.kp.pubkey());
    assert_anchor_error(env.send(&[ix], &[&carol]), AnchorError::ConstraintSeeds);
}

#[test]
fn users_without_a_position_cannot_claim() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);
    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&market, &price).unwrap();
    assert_anchor_error(env.claim(&market, Who::Creator), AnchorError::AccountNotInitialized);
}

// -------------------------------------------------------- rounding & close_market

#[test]
fn rounding_dust_stays_in_vault_and_goes_to_creator_on_close() {
    let mut env = Env::new();
    let market = env.create_market(default_params(1));
    // 3 equal YES stakes, pot of 10: each is owed 10/3 = 3.33, paid 3.
    env.bet(&market, Who::Alice, Side::Yes, 1).unwrap();
    env.bet(&market, Who::Bob, Side::Yes, 1).unwrap();
    env.bet(&market, Who::Creator, Side::Yes, 1).unwrap();
    env.bet(&market, Who::Carol, Side::No, 7).unwrap();

    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&market, &price).unwrap();

    for who in [Who::Alice, Who::Bob, Who::Creator, Who::Carol] {
        env.claim(&market, who).unwrap();
    }
    assert_eq!(env.balance(&env.alice.ata), STARTING_BALANCE - 1 + 3);
    assert_eq!(env.balance(&env.bob.ata), STARTING_BALANCE - 1 + 3);
    let vault = env.vault_pda(&market);
    assert_eq!(env.balance(&vault), 1, "one unit of dust remains");

    let creator_before = env.balance(&env.creator.ata);
    env.close_market(&market).unwrap();
    assert_eq!(env.balance(&env.creator.ata), creator_before + 1);
}

#[test]
fn close_market_guards() {
    let mut env = Env::new();
    let market = seeded_market(&mut env, 1);

    assert_market_error(env.close_market(&market), MarketError::MarketStillOpen);

    env.set_time(RESOLVE);
    let price = env.price(PriceSpec::default());
    env.resolve(&market, &price).unwrap();
    env.claim(&market, Who::Alice).unwrap();
    assert_market_error(env.close_market(&market), MarketError::PositionsOutstanding);

    env.claim(&market, Who::Bob).unwrap();
    env.claim(&market, Who::Carol).unwrap();

    // Only the creator can close.
    let (mallory, mallory_ata) = env.user(Who::Alice);
    let ix = env.ix_close_market(&market, &mallory.pubkey(), &mallory_ata);
    assert_anchor_error(env.send(&[ix], &[&mallory]), AnchorError::ConstraintHasOne);

    env.close_market(&market).unwrap();
    assert!(!env.exists(&market));
}
