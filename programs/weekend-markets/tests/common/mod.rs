//! Shared LiteSVM harness: loads the compiled program, a 6-decimal collateral
//! mint, funded users, a controllable clock and forged Pyth price accounts.
#![allow(dead_code, clippy::result_large_err)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
    },
    litesvm::{types::TransactionResult, LiteSVM},
    litesvm_token::{
        get_spl_account, spl_token, CreateAssociatedTokenAccount, CreateMint, MintTo, TOKEN_ID,
    },
    pyth_solana_receiver_sdk::price_update::{PriceFeedMessage, PriceUpdateV2, VerificationLevel},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    weekend_markets::{
        constants::{MARKET_SEED, POSITION_SEED, VAULT_SEED},
        error::MarketError,
        CreateMarketParams, Market, Position, Side,
    },
};

pub const T0: i64 = 1_790_000_000;
pub const LOCK: i64 = T0 + 100;
pub const RESOLVE: i64 = T0 + 200;
pub const WINDOW: u32 = 60;
pub const VOID_DELAY: u32 = 3_600;
pub const FEED: [u8; 32] = [7u8; 32];
/// $180.00 at expo -2
pub const STRIKE: i64 = 18_000;
pub const STRIKE_EXPO: i32 = -2;
pub const STARTING_BALANCE: u64 = 1_000_000_000; // 1,000 units at 6 decimals

pub struct User {
    pub kp: Keypair,
    pub ata: Pubkey,
}

pub struct Env {
    pub svm: LiteSVM,
    pub program_id: Pubkey,
    pub payer: Keypair,
    pub mint: Pubkey,
    pub creator: User,
    pub alice: User,
    pub bob: User,
    pub carol: User,
}

impl Env {
    pub fn new() -> Self {
        let program_id = weekend_markets::id();
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/weekend_markets.so"
        ));
        svm.add_program(program_id, bytes).unwrap();

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let mint = CreateMint::new(&mut svm, &payer)
            .decimals(6)
            .send()
            .unwrap();

        let mut env = Env {
            svm,
            program_id,
            payer,
            mint,
            creator: placeholder(),
            alice: placeholder(),
            bob: placeholder(),
            carol: placeholder(),
        };
        env.creator = env.new_user(STARTING_BALANCE);
        env.alice = env.new_user(STARTING_BALANCE);
        env.bob = env.new_user(STARTING_BALANCE);
        env.carol = env.new_user(STARTING_BALANCE);
        env.set_time(T0);
        env
    }

    pub fn new_user(&mut self, balance: u64) -> User {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        let ata = CreateAssociatedTokenAccount::new(&mut self.svm, &self.payer, &self.mint)
            .owner(&kp.pubkey())
            .send()
            .unwrap();
        if balance > 0 {
            MintTo::new(&mut self.svm, &self.payer, &self.mint, &ata, balance)
                .send()
                .unwrap();
        }
        User { kp, ata }
    }

    pub fn set_time(&mut self, ts: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = ts;
        self.svm.set_sysvar(&clock);
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        self.svm.send_transaction(tx)
    }

    // ---------- PDAs ----------

    pub fn market_pda(&self, creator: &Pubkey, id: u64) -> Pubkey {
        Pubkey::find_program_address(
            &[MARKET_SEED, creator.as_ref(), &id.to_le_bytes()],
            &self.program_id,
        )
        .0
    }

    pub fn vault_pda(&self, market: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(&[VAULT_SEED, market.as_ref()], &self.program_id).0
    }

    pub fn position_pda(&self, market: &Pubkey, owner: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[POSITION_SEED, market.as_ref(), owner.as_ref()],
            &self.program_id,
        )
        .0
    }

    // ---------- instruction builders ----------

    pub fn ix_create_market(&self, creator: &Pubkey, params: CreateMarketParams) -> Instruction {
        let market = self.market_pda(creator, params.market_id);
        Instruction::new_with_bytes(
            self.program_id,
            &weekend_markets::instruction::CreateMarket { params }.data(),
            weekend_markets::accounts::CreateMarket {
                creator: *creator,
                market,
                collateral_mint: self.mint,
                vault: self.vault_pda(&market),
                token_program: TOKEN_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_place_bet(
        &self,
        market: &Pubkey,
        bettor: &Pubkey,
        bettor_token: &Pubkey,
        side: Side,
        amount: u64,
    ) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &weekend_markets::instruction::PlaceBet { side, amount }.data(),
            weekend_markets::accounts::PlaceBet {
                bettor: *bettor,
                market: *market,
                position: self.position_pda(market, bettor),
                collateral_mint: self.mint,
                bettor_token: *bettor_token,
                vault: self.vault_pda(market),
                token_program: TOKEN_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_resolve(&self, market: &Pubkey, price_update: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &weekend_markets::instruction::Resolve {}.data(),
            weekend_markets::accounts::Resolve {
                market: *market,
                price_update: *price_update,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_void(&self, market: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &weekend_markets::instruction::VoidMarket {}.data(),
            weekend_markets::accounts::VoidMarket { market: *market }.to_account_metas(None),
        )
    }

    pub fn ix_claim(&self, market: &Pubkey, owner: &Pubkey, owner_token: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &weekend_markets::instruction::Claim {}.data(),
            weekend_markets::accounts::Claim {
                owner: *owner,
                market: *market,
                position: self.position_pda(market, owner),
                collateral_mint: self.mint,
                owner_token: *owner_token,
                vault: self.vault_pda(market),
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn ix_close_market(
        &self,
        market: &Pubkey,
        creator: &Pubkey,
        creator_token: &Pubkey,
    ) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &weekend_markets::instruction::CloseMarket {}.data(),
            weekend_markets::accounts::CloseMarket {
                creator: *creator,
                market: *market,
                collateral_mint: self.mint,
                creator_token: *creator_token,
                vault: self.vault_pda(market),
                token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        )
    }

    // ---------- high-level actions ----------

    /// Creates a market as `creator` and returns its address.
    pub fn create_market(&mut self, params: CreateMarketParams) -> Pubkey {
        let creator = self.creator.kp.insecure_clone();
        let market = self.market_pda(&creator.pubkey(), params.market_id);
        let ix = self.ix_create_market(&creator.pubkey(), params);
        self.send(&[ix], &[&creator]).expect("create_market");
        market
    }

    pub fn bet(&mut self, market: &Pubkey, who: Who, side: Side, amount: u64) -> TransactionResult {
        let (kp, ata) = self.user(who);
        let ix = self.ix_place_bet(market, &kp.pubkey(), &ata, side, amount);
        self.send(&[ix], &[&kp])
    }

    pub fn claim(&mut self, market: &Pubkey, who: Who) -> TransactionResult {
        let (kp, ata) = self.user(who);
        let ix = self.ix_claim(market, &kp.pubkey(), &ata);
        self.send(&[ix], &[&kp])
    }

    pub fn resolve(&mut self, market: &Pubkey, price_update: &Pubkey) -> TransactionResult {
        let payer = self.payer.insecure_clone();
        let ix = self.ix_resolve(market, price_update);
        self.send(&[ix], &[&payer])
    }

    pub fn void(&mut self, market: &Pubkey) -> TransactionResult {
        let payer = self.payer.insecure_clone();
        let ix = self.ix_void(market);
        self.send(&[ix], &[&payer])
    }

    pub fn close_market(&mut self, market: &Pubkey) -> TransactionResult {
        let creator = self.creator.kp.insecure_clone();
        let ix = self.ix_close_market(market, &creator.pubkey(), &self.creator.ata);
        self.send(&[ix], &[&creator])
    }

    pub fn user(&self, who: Who) -> (Keypair, Pubkey) {
        let u = match who {
            Who::Creator => &self.creator,
            Who::Alice => &self.alice,
            Who::Bob => &self.bob,
            Who::Carol => &self.carol,
        };
        (u.kp.insecure_clone(), u.ata)
    }

    // ---------- Pyth ----------

    /// Writes a `PriceUpdateV2` account owned by `owner` (the Pyth receiver
    /// unless a test is forging one) and returns its address.
    pub fn put_price_update(&mut self, owner: Pubkey, update: PriceUpdateV2) -> Pubkey {
        let address = Pubkey::new_unique();
        let mut data = Vec::new();
        update.try_serialize(&mut data).unwrap();
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm
            .set_account(
                address,
                Account {
                    lamports,
                    data,
                    owner,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        address
    }

    pub fn price(&mut self, spec: PriceSpec) -> Pubkey {
        self.put_price_update(pyth_solana_receiver_sdk::ID, spec.build())
    }

    // ---------- reads ----------

    pub fn market(&self, market: &Pubkey) -> Market {
        let acc = self.svm.get_account(market).expect("market account");
        Market::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn position(&self, market: &Pubkey, owner: &Pubkey) -> Option<Position> {
        let acc = self.svm.get_account(&self.position_pda(market, owner))?;
        if acc.data.is_empty() {
            return None;
        }
        Some(Position::try_deserialize(&mut acc.data.as_slice()).unwrap())
    }

    pub fn balance(&self, token_account: &Pubkey) -> u64 {
        get_spl_account::<spl_token::state::Account>(&self.svm, token_account)
            .unwrap()
            .amount
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.svm
            .get_account(address)
            .map(|a| a.lamports > 0)
            .unwrap_or(false)
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Who {
    Creator,
    Alice,
    Bob,
    Carol,
}

/// A settlement price at `RESOLVE` for `FEED`, overridable field by field.
#[derive(Clone, Copy)]
pub struct PriceSpec {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub verification: VerificationLevel,
}

impl Default for PriceSpec {
    fn default() -> Self {
        PriceSpec {
            feed_id: FEED,
            price: 18_050_000, // $180.50 at expo -5
            conf: 10_000,      // $0.10
            expo: -5,
            publish_time: RESOLVE,
            prev_publish_time: RESOLVE - 1,
            verification: VerificationLevel::Full,
        }
    }
}

impl PriceSpec {
    pub fn build(self) -> PriceUpdateV2 {
        PriceUpdateV2 {
            write_authority: Pubkey::new_unique(),
            verification_level: self.verification,
            price_message: PriceFeedMessage {
                feed_id: self.feed_id,
                price: self.price,
                conf: self.conf,
                exponent: self.expo,
                publish_time: self.publish_time,
                prev_publish_time: self.prev_publish_time,
                ema_price: self.price,
                ema_conf: self.conf,
            },
            posted_slot: 1,
        }
    }
}

pub fn default_params(market_id: u64) -> CreateMarketParams {
    CreateMarketParams {
        market_id,
        feed_id: FEED,
        strike_price: STRIKE,
        strike_expo: STRIKE_EXPO,
        lock_ts: LOCK,
        resolve_ts: RESOLVE,
        resolve_window_secs: WINDOW,
        void_delay_secs: VOID_DELAY,
        max_conf_bps: 100,
    }
}

fn placeholder() -> User {
    User {
        kp: Keypair::new(),
        ata: Pubkey::default(),
    }
}

// ---------- error assertions ----------

pub fn program_error_code(e: MarketError) -> u32 {
    anchor_lang::error::ERROR_CODE_OFFSET + e as u32
}

pub fn assert_custom_error(res: TransactionResult, code: u32) {
    match res {
        Ok(_) => panic!("expected custom error {code}, transaction succeeded"),
        Err(failed) => {
            let got = format!("{:?}", failed.err);
            assert!(
                got.contains(&format!("Custom({code})")),
                "expected Custom({code}), got {got}\nlogs:\n{}",
                failed.meta.logs.join("\n")
            );
        }
    }
}

pub fn assert_market_error(res: TransactionResult, e: MarketError) {
    assert_custom_error(res, program_error_code(e));
}

pub fn assert_anchor_error(res: TransactionResult, e: anchor_lang::error::ErrorCode) {
    assert_custom_error(res, e as u32);
}
