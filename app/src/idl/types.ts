/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/safexy_escrow.json`.
 */
export type SafexyEscrow = {
  "address": "3XtS8x4cttGfBK2QhbqKpbVDnon4eeQembPbxpjvtL63",
  "metadata": {
    "name": "safexyEscrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "SAFXY P2P escrow on Solana"
  },
  "instructions": [
    {
      "name": "accept",
      "docs": [
        "User B (`seller`) accepts the escrow before the 48h acceptance deadline."
      ],
      "discriminator": [
        65,
        150,
        70,
        216,
        133,
        6,
        107,
        4
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.buyer",
                "account": "escrow"
              },
              {
                "kind": "account",
                "path": "escrow.escrow_id",
                "account": "escrow"
              }
            ]
          }
        },
        {
          "name": "seller",
          "signer": true,
          "relations": [
            "escrow"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "counterOffer",
      "docs": [
        "B proposes to receive `seller_amount` instead of the full amount.",
        "The difference goes back to A on release."
      ],
      "discriminator": [
        212,
        52,
        120,
        221,
        104,
        231,
        68,
        97
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.buyer",
                "account": "escrow"
              },
              {
                "kind": "account",
                "path": "escrow.escrow_id",
                "account": "escrow"
              }
            ]
          }
        },
        {
          "name": "seller",
          "signer": true,
          "relations": [
            "escrow"
          ]
        }
      ],
      "args": [
        {
          "name": "sellerAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "User A (`buyer`) locks `amount` lamports for `seller` (user B).",
        "The escrow PDA itself holds the funds; its data records the deadlines",
        "computed from the config windows at deposit time."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "seller"
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "arg",
                "path": "escrowId"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "escrowId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "expire",
      "docs": [
        "Deadline passed: anyone (the keeper bot, A, or any crank caller) can",
        "trigger it — the funds can only go back to A, so it is safe to be",
        "permissionless. `Created` expires after the 48h acceptance deadline;",
        "every other live state expires after the 60-day dispute deadline."
      ],
      "discriminator": [
        243,
        83,
        205,
        58,
        57,
        201,
        247,
        146
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.buyer",
                "account": "escrow"
              },
              {
                "kind": "account",
                "path": "escrow.escrow_id",
                "account": "escrow"
              }
            ]
          }
        },
        {
          "name": "buyerWallet",
          "writable": true
        },
        {
          "name": "caller",
          "docs": [
            "Keeper, A, or anyone else — the payout destination is fixed to A."
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "docs": [
        "One-time setup: creates the protocol config PDA (platform wallet,",
        "keeper, fee and deadline windows). `authority` can update it later."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "pubkey"
        },
        {
          "name": "keeper",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u64"
        },
        {
          "name": "acceptanceWindow",
          "type": "i64"
        },
        {
          "name": "disputeWindow",
          "type": "i64"
        },
        {
          "name": "minDeposit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refund",
      "docs": [
        "A takes the full deposit back: any time while `Created` (B never",
        "accepted), or after the 60-day dispute deadline in any other state."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.buyer",
                "account": "escrow"
              },
              {
                "kind": "account",
                "path": "escrow.escrow_id",
                "account": "escrow"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true,
          "relations": [
            "escrow"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "rejectCounterOffer",
      "docs": [
        "A rejects B's counteroffer; the escrow goes back to `Accepted`."
      ],
      "discriminator": [
        15,
        233,
        114,
        177,
        34,
        171,
        222,
        60
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.buyer",
                "account": "escrow"
              },
              {
                "kind": "account",
                "path": "escrow.escrow_id",
                "account": "escrow"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "signer": true,
          "relations": [
            "escrow"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "release",
      "docs": [
        "Mutual release: A and B must both sign.",
        "- state `Accepted`: B gets `amount - fee`, platform gets `fee`.",
        "- state `CounterOffer(x)`: B gets `x - fee`, platform gets `fee`,",
        "A gets the remaining `amount - x`.",
        "The program itself moves the lamports, so the 1% split is enforced",
        "on-chain: no trust in the transaction builder is needed."
      ],
      "discriminator": [
        253,
        249,
        15,
        206,
        28,
        127,
        193,
        241
      ],
      "accounts": [
        {
          "name": "platform",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "escrow.buyer",
                "account": "escrow"
              },
              {
                "kind": "account",
                "path": "escrow.escrow_id",
                "account": "escrow"
              }
            ]
          }
        },
        {
          "name": "seller",
          "docs": [
            "account destination. Verified against the escrow data."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "escrow"
          ]
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true,
          "relations": [
            "escrow"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "docs": [
        "Authority-only update of the protocol parameters / wallets."
      ],
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        }
      ],
      "args": [
        {
          "name": "platform",
          "type": "pubkey"
        },
        {
          "name": "keeper",
          "type": "pubkey"
        },
        {
          "name": "feeBps",
          "type": "u64"
        },
        {
          "name": "acceptanceWindow",
          "type": "i64"
        },
        {
          "name": "disputeWindow",
          "type": "i64"
        },
        {
          "name": "minDeposit",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "escrow",
      "discriminator": [
        31,
        213,
        123,
        187,
        186,
        22,
        218,
        155
      ]
    }
  ],
  "events": [
    {
      "name": "escrowEvent",
      "discriminator": [
        241,
        51,
        61,
        3,
        5,
        32,
        113,
        144
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidFeeBps",
      "msg": "Fee must be <= 10000 bps"
    },
    {
      "code": 6001,
      "name": "invalidWindow",
      "msg": "Invalid deadline window"
    },
    {
      "code": 6002,
      "name": "belowMinDeposit",
      "msg": "Deposit below the configured minimum"
    },
    {
      "code": 6003,
      "name": "sameParty",
      "msg": "Buyer and seller must differ"
    },
    {
      "code": 6004,
      "name": "invalidState",
      "msg": "Invalid escrow state for this action"
    },
    {
      "code": 6005,
      "name": "acceptanceDeadlinePassed",
      "msg": "The 48h acceptance deadline has passed"
    },
    {
      "code": 6006,
      "name": "disputeDeadlinePassed",
      "msg": "The 60-day dispute deadline has passed"
    },
    {
      "code": 6007,
      "name": "tooEarly",
      "msg": "Deadline has not been reached yet"
    },
    {
      "code": 6008,
      "name": "notAccepted",
      "msg": "Escrow was never accepted"
    },
    {
      "code": 6009,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6010,
      "name": "wrongPlatform",
      "msg": "Platform account does not match the config"
    },
    {
      "code": 6011,
      "name": "wrongBuyer",
      "msg": "Buyer account does not match the escrow"
    },
    {
      "code": 6012,
      "name": "overflow",
      "msg": "Math overflow"
    }
  ],
  "types": [
    {
      "name": "action",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "deposit"
          },
          {
            "name": "accept"
          },
          {
            "name": "counterOffer"
          },
          {
            "name": "rejectCounterOffer"
          },
          {
            "name": "release"
          },
          {
            "name": "refund"
          },
          {
            "name": "expire"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "platform",
            "type": "pubkey"
          },
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u64"
          },
          {
            "name": "acceptanceWindow",
            "type": "i64"
          },
          {
            "name": "disputeWindow",
            "type": "i64"
          },
          {
            "name": "minDeposit",
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
      "name": "escrow",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "docs": [
              "User A — deposits, and receives refunds / expiry payouts."
            ],
            "type": "pubkey"
          },
          {
            "name": "seller",
            "docs": [
              "User B — accepts, and receives the release minus the platform fee."
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowId",
            "type": "u64"
          },
          {
            "name": "amount",
            "docs": [
              "Locked lamports (excludes rent)."
            ],
            "type": "u64"
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix seconds."
            ],
            "type": "i64"
          },
          {
            "name": "acceptanceDeadline",
            "type": "i64"
          },
          {
            "name": "disputeDeadline",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "escrowState"
              }
            }
          },
          {
            "name": "counterOfferAmount",
            "docs": [
              "Valid while state == CounterOffer: gross amount B proposed for himself."
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Snapshot of the config fee at deposit time."
            ],
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
      "name": "escrowEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": {
              "defined": {
                "name": "action"
              }
            }
          },
          {
            "name": "actor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "escrowState",
      "docs": [
        "On-chain lifecycle. The first three variants are the live states stored in",
        "the account; `Released` / `Refunded` / `Expired` are terminal — on Solana",
        "they are reached by closing the escrow account, and are surfaced through",
        "events instead of stored data."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "created"
          },
          {
            "name": "accepted"
          },
          {
            "name": "counterOffer"
          },
          {
            "name": "released"
          },
          {
            "name": "refunded"
          },
          {
            "name": "expired"
          }
        ]
      }
    }
  ]
};
