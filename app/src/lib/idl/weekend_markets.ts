/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/weekend_markets.json`.
 */
export type WeekendMarkets = {
  "address": "2oihGq9YRDQkgeEXwrzGcgs9UjDZVUKeKZCP81UkTSN9",
  "metadata": {
    "name": "weekendMarkets",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Binary prediction markets on tokenized-stock prices, settled trustlessly by Pyth"
  },
  "instructions": [
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "market",
          "writable": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "collateralMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeMarket",
      "discriminator": [
        88,
        154,
        248,
        186,
        48,
        14,
        123,
        244
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "collateralMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "creatorToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createMarket",
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "params.marketId"
              }
            ]
          }
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "createMarketParams"
            }
          }
        }
      ]
    },
    {
      "name": "placeBet",
      "discriminator": [
        222,
        62,
        67,
        220,
        63,
        166,
        126,
        33
      ],
      "accounts": [
        {
          "name": "bettor",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "bettor"
              }
            ]
          }
        },
        {
          "name": "collateralMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "bettorToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resolve",
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        },
        {
          "name": "priceUpdate",
          "docs": [
            "`Account` checks this is owned by the Pyth receiver program, so the",
            "contents were posted (and signature-checked) by Pyth, not by the caller."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "voidMarket",
      "discriminator": [
        243,
        175,
        46,
        124,
        95,
        101,
        39,
        69
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    }
  ],
  "events": [
    {
      "name": "betPlaced",
      "discriminator": [
        88,
        88,
        145,
        226,
        126,
        206,
        32,
        0
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    },
    {
      "name": "marketVoided",
      "discriminator": [
        217,
        12,
        138,
        39,
        108,
        75,
        89,
        26
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "lockInPast",
      "msg": "lock_ts must be in the future"
    },
    {
      "code": 6001,
      "name": "resolveBeforeLock",
      "msg": "resolve_ts must be at or after lock_ts"
    },
    {
      "code": 6002,
      "name": "invalidResolveWindow",
      "msg": "resolve window must be between 1 second and 1 hour"
    },
    {
      "code": 6003,
      "name": "invalidVoidDelay",
      "msg": "void delay must be between 1 hour and 7 days"
    },
    {
      "code": 6004,
      "name": "invalidConfidenceBound",
      "msg": "max_conf_bps must be between 1 and 10000"
    },
    {
      "code": 6005,
      "name": "invalidStrike",
      "msg": "strike price must be positive"
    },
    {
      "code": 6006,
      "name": "invalidExponent",
      "msg": "exponent must be between -18 and 0"
    },
    {
      "code": 6007,
      "name": "invalidFeedId",
      "msg": "feed id must not be empty"
    },
    {
      "code": 6008,
      "name": "zeroAmount",
      "msg": "bet amount must be greater than zero"
    },
    {
      "code": 6009,
      "name": "marketNotOpen",
      "msg": "market is not open"
    },
    {
      "code": 6010,
      "name": "bettingClosed",
      "msg": "betting has closed for this market"
    },
    {
      "code": 6011,
      "name": "tooEarlyToResolve",
      "msg": "market cannot be resolved before resolve_ts"
    },
    {
      "code": 6012,
      "name": "insufficientVerification",
      "msg": "price update is not fully verified by Wormhole guardians"
    },
    {
      "code": 6013,
      "name": "feedMismatch",
      "msg": "price update is for a different feed"
    },
    {
      "code": 6014,
      "name": "priceBeforeResolveTime",
      "msg": "price was published before resolve_ts"
    },
    {
      "code": 6015,
      "name": "priceAfterResolveWindow",
      "msg": "price was published after the resolve window closed"
    },
    {
      "code": 6016,
      "name": "notFirstPriceAfterResolveTime",
      "msg": "price is not the first update at or after resolve_ts"
    },
    {
      "code": 6017,
      "name": "nonPositivePrice",
      "msg": "oracle price must be positive"
    },
    {
      "code": 6018,
      "name": "confidenceTooWide",
      "msg": "oracle confidence interval is too wide to settle"
    },
    {
      "code": 6019,
      "name": "tooEarlyToVoid",
      "msg": "market cannot be voided yet"
    },
    {
      "code": 6020,
      "name": "marketStillOpen",
      "msg": "market is still open"
    },
    {
      "code": 6021,
      "name": "positionsOutstanding",
      "msg": "market still has unclaimed positions"
    },
    {
      "code": 6022,
      "name": "mathOverflow",
      "msg": "arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "betPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "bettor",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "side"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "yesPool",
            "type": "u64"
          },
          {
            "name": "noPool",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "createMarketParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "strikePrice",
            "type": "i64"
          },
          {
            "name": "strikeExpo",
            "type": "i32"
          },
          {
            "name": "lockTs",
            "type": "i64"
          },
          {
            "name": "resolveTs",
            "type": "i64"
          },
          {
            "name": "resolveWindowSecs",
            "type": "u32"
          },
          {
            "name": "voidDelaySecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "A binary parimutuel market: \"will `feed_id` print at or above `strike` at `resolve_ts`?\"",
        "",
        "Bets are pooled per side. Winners split the whole pot pro rata to their stake;",
        "there is no house, no fee and no AMM, so the market can't be insolvent."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "collateralMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "docs": [
              "Pyth price feed id (e.g. Equity.US.NVDA/USD)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "strikePrice",
            "docs": [
              "Strike is `strike_price * 10^strike_expo`."
            ],
            "type": "i64"
          },
          {
            "name": "strikeExpo",
            "type": "i32"
          },
          {
            "name": "lockTs",
            "docs": [
              "No bets at or after this time."
            ],
            "type": "i64"
          },
          {
            "name": "resolveTs",
            "docs": [
              "Settlement uses the first Pyth price published at or after this time."
            ],
            "type": "i64"
          },
          {
            "name": "resolveWindowSecs",
            "docs": [
              "The settlement price must be published within `resolve_window_secs` of `resolve_ts`."
            ],
            "type": "u32"
          },
          {
            "name": "voidDelaySecs",
            "docs": [
              "After `resolve_ts + resolve_window_secs + void_delay_secs` an unresolved market can be voided."
            ],
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "docs": [
              "Reject settlement prices whose confidence interval exceeds this fraction of price."
            ],
            "type": "u16"
          },
          {
            "name": "yesPool",
            "type": "u64"
          },
          {
            "name": "noPool",
            "type": "u64"
          },
          {
            "name": "openPositions",
            "docs": [
              "Positions not yet claimed; the market can only be closed at zero."
            ],
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "outcome",
            "type": {
              "option": {
                "defined": {
                  "name": "side"
                }
              }
            }
          },
          {
            "name": "voidReason",
            "type": {
              "option": {
                "defined": {
                  "name": "voidReason"
                }
              }
            }
          },
          {
            "name": "settlePrice",
            "type": "i64"
          },
          {
            "name": "settleConf",
            "type": "u64"
          },
          {
            "name": "settleExpo",
            "type": "i32"
          },
          {
            "name": "settlePublishTime",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "strikePrice",
            "type": "i64"
          },
          {
            "name": "strikeExpo",
            "type": "i32"
          },
          {
            "name": "lockTs",
            "type": "i64"
          },
          {
            "name": "resolveTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "side"
              }
            }
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "expo",
            "type": "i32"
          },
          {
            "name": "publishTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "resolved"
          },
          {
            "name": "voided"
          }
        ]
      }
    },
    {
      "name": "marketVoided",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": {
              "defined": {
                "name": "voidReason"
              }
            }
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "yesAmount",
            "type": "u64"
          },
          {
            "name": "noAmount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "priceFeedMessage",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedId",
            "docs": [
              "`FeedId` but avoid the type alias because of compatibility issues with Anchor's `idl-build` feature."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "exponent",
            "type": "i32"
          },
          {
            "name": "publishTime",
            "docs": [
              "The timestamp of this price update in seconds"
            ],
            "type": "i64"
          },
          {
            "name": "prevPublishTime",
            "docs": [
              "The timestamp of the previous price update. This field is intended to allow users to",
              "identify the single unique price update for any moment in time:",
              "for any time t, the unique update is the one such that prev_publish_time < t <= publish_time.",
              "",
              "Note that there may not be such an update while we are migrating to the new message-sending logic,",
              "as some price updates on pythnet may not be sent to other chains (because the message-sending",
              "logic may not have triggered). We can solve this problem by making the message-sending mandatory",
              "(which we can do once publishers have migrated over).",
              "",
              "Additionally, this field may be equal to publish_time if the message is sent on a slot where",
              "where the aggregation was unsuccesful. This problem will go away once all publishers have",
              "migrated over to a recent version of pyth-agent."
            ],
            "type": "i64"
          },
          {
            "name": "emaPrice",
            "type": "i64"
          },
          {
            "name": "emaConf",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceUpdateV2",
      "docs": [
        "A price update account. This account is used by the Pyth Receiver program to store a verified price update from a Pyth price feed.",
        "It contains:",
        "- `write_authority`: The write authority for this account. This authority can close this account to reclaim rent or update the account to contain a different price update.",
        "- `verification_level`: The [`VerificationLevel`] of this price update. This represents how many Wormhole guardian signatures have been verified for this price update.",
        "- `price_message`: The actual price update.",
        "- `posted_slot`: The slot at which this price update was posted."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "writeAuthority",
            "type": "pubkey"
          },
          {
            "name": "verificationLevel",
            "type": {
              "defined": {
                "name": "verificationLevel"
              }
            }
          },
          {
            "name": "priceMessage",
            "type": {
              "defined": {
                "name": "priceFeedMessage"
              }
            }
          },
          {
            "name": "postedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yes"
          },
          {
            "name": "no"
          }
        ]
      }
    },
    {
      "name": "verificationLevel",
      "docs": [
        "Pyth price updates are bridged to all blockchains via Wormhole.",
        "Using the price updates on another chain requires verifying the signatures of the Wormhole guardians.",
        "The usual process is to check the signatures for two thirds of the total number of guardians, but this can be cumbersome on Solana because of the transaction size limits,",
        "so we also allow for partial verification.",
        "",
        "This enum represents how much a price update has been verified:",
        "- If `Full`, we have verified the signatures for two thirds of the current guardians.",
        "- If `Partial`, only `num_signatures` guardian signatures have been checked.",
        "",
        "# Warning",
        "Using partially verified price updates is dangerous, as it lowers the threshold of guardians that need to collude to produce a malicious price update."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "partial",
            "fields": [
              {
                "name": "numSignatures",
                "type": "u8"
              }
            ]
          },
          {
            "name": "full"
          }
        ]
      }
    },
    {
      "name": "voidReason",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "oneSidedPool"
          },
          {
            "name": "noOraclePrice"
          }
        ]
      }
    }
  ]
};
