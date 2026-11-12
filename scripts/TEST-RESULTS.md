# Thursday go/no-go test: results

**Result: GO.** Run on NEAR mainnet, Thursday 12 Nov 2026, 11:40–12:23 UTC.

A 2 USDC payment from Base, sent through 1Click with `customRecipientMsg` set
to the order id, reached the escrow and marked order 1 **Funded** with no manual
step. The buyer's signed "delivered" message then moved the order to
**Delivered**. After the 10-minute complaint window, `release` paid the seller
**2 USDC inside NEAR Intents**.

**Decision:** build on 1Click with `customRecipientMsg`. The collector fallback is
not needed. Payout mode `Intents` works, so `Direct` is not needed.

Account names are left out of this file on purpose. Every account below is the
owner account (owner, relayer, seller and buyer refund for this test) or its
`escrow.` sub-account.

## Order 1

| | |
| --- | --- |
| Order id | `1` |
| Price | 2000000 units (2 USDC) |
| Paid from | USDC on Base (`nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`) |
| Delivery proof | Buyer signature (`confirm_by_buyer`) |
| Final status | **Released** at 12:22:26 UTC |

## Transactions

| Step | Transaction | Result |
| --- | --- | --- |
| 1. Create escrow sub-account, fund with 4 NEAR | [9KEeCjwq…szMxe](https://nearblocks.io/txns/9KEeCjwqKEKBjx8RbdVqj7Yxb22buwdco1rf8kQszMxe) | Account created |
| 2. Deploy wasm and call `new(...)` | [54VS7GYN…ChaaLD](https://nearblocks.io/txns/54VS7GYNs4ivviqZicAQkYjqvnaQtphvZDAa6HChaaLD) | Code hash on chain matches `res/doorstep_escrow.wasm` |
| 3. Register escrow with USDC (`storage_deposit`) | [3tJjpXFe…VdnC](https://nearblocks.io/txns/3tJjpXFe5guEatuzapczcsjV5wqbWS2adXZqQGQeVdnC) | Registered |
| 4. `create_order` (2 USDC, deadline 24 h) | [6u89iZd2…FD65W](https://nearblocks.io/txns/6u89iZd2wVYwCovFEEKfQRD8Nhowf74u1XQUVGWFD65W) | Order 1, status Created |
| 5a. 1Click settlement | [GfzVsYg3…4Muo](https://nearblocks.io/txns/GfzVsYg3ANnwHW8zhMrMMxuMH4AfucUv39Nx3paE4Muo) | |
| 5b. 1Click settlement | [2mdhBN3T…EybX](https://nearblocks.io/txns/2mdhBN3TBTwNrj5PEgwguzSAM2LmLVZ6pWBULMFAEybX) | |
| 5c. 1Click settlement | [CKaEX9qD…nBCi](https://nearblocks.io/txns/CKaEX9qDc1vbYqyeJP2aJmuRz8miSAzQHBtBS2NQnBCi) | |
| 5d. 1Click delivery to the escrow | [2UbLNGvo…5to2](https://nearblocks.io/txns/2UbLNGvoSrFPkRmUzsaYtpwivhfn31a9hmXGKbFG5to2) | Order 1 **Funded**, paid 2000000 |
| 6. `confirm_by_buyer` | [mdohvkM8…3rG](https://nearblocks.io/txns/mdohvkM81QV8qK9VRnK1uqRmEjT57A847uRoS8VA3rG) | Order 1 Delivered, `order_delivered` event, proof `buyer` |
| 7. `release` | [3RaweBZ8…UaZK](https://nearblocks.io/txns/3RaweBZ8B6V2yuKbnqayReqgQwraEgBYUN9EXA2WUaZK) | Order 1 Released, seller paid in NEAR Intents |

## 1Click payment

| | |
| --- | --- |
| Request | `EXACT_OUTPUT`, 100 bps slippage, recipient = escrow (`DESTINATION_CHAIN`), `customRecipientMsg` = `"1"` |
| Quote | Send 2.020614 USDC (minimum 2.000407); escrow receives exactly 2.000000 USDC; ETA 35 s |
| Deposit address | `0xb60A43d045364febb27F3e13E13a25e6Eb10348F` (Base) |
| Signed quote | `.runs/quote-order1-1794484667590.json` (git-ignored; keep it) |
| Auth | None. No API key or JWT, so 1Click added 0.1% |

Timeline (UTC):

| Time | Event |
| --- | --- |
| 11:57:47 | Real quote issued |
| 11:57:48 | `PENDING_DEPOSIT` |
| 12:09:54 | `PROCESSING` (deposit seen) |
| 12:10:04 | Order 1 Funded on chain (`funded_ms`) |
| 12:10:11 | 1Click status `SUCCESS` (it lags the chain by a few seconds) |

## Payout check

| Check | Before | After |
| --- | --- | --- |
| Seller's USDC inside NEAR Intents (`intents.near` `mt_balance_of`, `nep141:17208628…33a1`) | 0 (11:48 UTC) | **2000000** (+2000000, as expected) |
| Escrow USDC balance | 2000000 | 0 |
| Parked (unmatched) payments | 0 | 0 |

Logs from the `release` transaction, in order:

1. Escrow emits `order_released`, amount 2000000.
2. The USDC contract transfers 2000000 from the escrow to `intents.near`.
3. `intents.near` mints 2000000 of the USDC token to the seller (`mt_mint`, memo `deposit`).
4. The escrow's callback emits `payout_done`, amount 2000000, and returns `"2000000"`. NEAR Intents kept all of it, so nothing was rolled back.

## Costs

| Item | Amount |
| --- | --- |
| Moved into the escrow account (still ours) | 4 NEAR. 2.6768 NEAR is held for code storage; 1.32 NEAR is free (about 440 orders at ~0.003 NEAR each) |
| Transaction fees | about 0.0115 NEAR across six transactions, plus the 0.00125 NEAR USDC storage deposit |
| Owner account balance | 7.7259 NEAR before, 3.7155 NEAR after |
| USDC | 2.020614 sent from Base; 2.000000 delivered. The difference is 1Click's fee plus the slippage allowance. Not checked: whether 1Click refunded part of it to the Base wallet |

## What went wrong or needed fixing

- The brief referenced `CLAUDE.md` and `npm run` commands. Neither exists: there is no `CLAUDE.md` and no root `package.json`. We ran the `bash scripts/...` and `node scripts/...` commands directly.
- Rust and near-cli-rs were missing.
  - Both were installed (rustc 1.99.1, rust-src, near-cli-rs 0.31.1).
  - npm's `allow-scripts` blocked near-cli-rs's postinstall; the binary downloaded on first run instead.
- `rustup target add wasm32-unknown-unknown` did not run: a pasted `# comment` was passed to rustup as an argument by zsh. That target is only needed to rebuild the contract.
- The owner key was not in the macOS keychain at first. We imported it with `near account import-account` (seed phrase, save to keychain).
- 1Click returned a deposit deadline of 15 Nov 12:27 UTC, although the script asked for 30 minutes. Harmless, but the script only watches for 60 minutes, so a late deposit needs `--watch <depositAddress>`.
- `oneclick-test.mjs` prints the "no API key" note on every status poll. This is noise only.
- 49/49 contract unit tests passed before deploying. No near-workspaces sandbox tests exist yet.

## Not tested yet

- Seller withdrawal from NEAR Intents to another chain: the last step of the demo.
- `refund` after the deadline, `raise_complaint` and `resolve`, the checker signature (`confirm_by_checker`), parked payments and `refund_unmatched`, and the `Direct` payout mode.
- Paying from Arbitrum or any non-USDC token.
- Refunds to a buyer with no NEAR account: which account id to credit is still an open question in the build plan.

## Next

1. Get a 1Click JWT before real orders, to remove the 0.1% fee.
2. Test the seller withdrawal out of NEAR Intents with these 2 USDC.
3. Build the backend on this exact request shape (`scripts/oneclick-test.mjs`).
