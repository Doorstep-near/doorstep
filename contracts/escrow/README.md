# Doorstep escrow contract

Holds USDC for each order and pays the seller only when delivery is proven.
Rust, near-sdk 5.30.

## Order lifecycle

| Status | How it gets here | Next |
| --- | --- | --- |
| Created | `create_order` (relayer or owner) | Funded, or Expired after the deadline |
| Funded | At least the price in USDC arrives with `msg` = order id | Shipped, Delivered, or Refunded after the deadline |
| Shipped | `mark_shipped` with a courier reference | Delivered, or Refunded after the deadline |
| Delivered | Buyer's signature, or a checker signature | Released after the window, or Disputed |
| Disputed | Buyer's complaint signature inside the window | Released or Refunded by the owner |
| Released / Refunded / Expired | Final | Nothing |

## Signed messages

The buyer's browser makes an ed25519 key pair; only its public key is stored
with the order. Messages are plain UTF-8 text; signatures are base64 (64 bytes).

| Who | Message | Used by |
| --- | --- | --- |
| Buyer | `delivered\|<order_id>\|<contract>` | `confirm_by_buyer` |
| Buyer | `complaint\|<order_id>\|<contract>` | `raise_complaint` |
| Checker | `checker\|delivered\|<order_id>\|<courier_ref>\|<signed_at>\|<contract>` | `confirm_by_checker` |

Views `delivered_message`, `complaint_message` and `checker_message` return the
exact text, so frontends never have to rebuild it.

## Methods

| Method | Who | Notes |
| --- | --- | --- |
| `new(owner, relayer, usdc, checker_pk, complaint_window_ms, intents?)` | deployer | `intents` defaults to `intents.near` |
| `create_order(seller, price, deadline_ms, buyer_pk, buyer_refund)` | relayer, owner | Returns the order id |
| `ft_on_transfer(sender_id, amount, msg)` | USDC contract | Never returns money; extra or unmatched payments are parked |
| `mark_shipped(order_id, courier_ref)` | seller, relayer, owner | `courier_ref` 1-128 chars, no `\|` |
| `confirm_by_buyer(order_id, signature)` | anyone | |
| `confirm_by_checker(order_id, courier_ref, signed_at, signature)` | anyone | `courier_ref` must match the stored one if set |
| `raise_complaint(order_id, signature)` | anyone | Inside the complaint window |
| `release(order_id)` | anyone | After the window. Attach 100 Tgas |
| `refund(order_id)` | anyone | After the deadline. Attach 100 Tgas |
| `resolve(order_id, to_seller)` | owner | Disputed orders. Attach 100 Tgas |
| `refund_unmatched(id, to?)` | owner | `to` required if the buyer is unknown |
| `set_checker_pk`, `set_relayer`, `set_complaint_window`, `set_payout_mode` | owner | |
| `get_order`, `orders_for_seller`, `get_unmatched`, `get_config` | view | |

Amounts are USDC units as strings (6 decimals: `"2000000"` = 2 USDC). Times are
milliseconds as strings. Logs are `EVENT_JSON:` lines (`order_created`,
`order_funded`, `order_delivered`, `order_released`, `payout_failed`, ...)
for the backend to follow.

## Payouts

`release`, `refund`, `resolve` and `refund_unmatched` set the final status,
then send USDC with `ft_transfer_call` to `intents.near` with `msg` = the
recipient's account, so they're credited inside NEAR Intents. The `on_payout`
callback reads how much NEAR Intents kept; if it kept nothing (or the
transfer failed), it puts the order back so the payout can be retried. If
NEAR Intents ever refuses our deposits, the owner can switch to
`set_payout_mode("Direct")`, which sends straight to the recipient's NEAR
account.

## Build, test, deploy

```bash
cargo test                          # 49 unit tests
bash ../../scripts/build-contract.sh  # wasm for the MVP feature set -> res/
bash ../../scripts/deploy.sh all      # see scripts/README.md
```

The build rebuilds Rust's standard library for plain (MVP) wasm, because
newer Rust turns on wasm features NEAR may reject. It needs `rustup component
add rust-src`. `res/doorstep_escrow.wasm` was built this way and checked with
`wasm-opt --mvp-features`.

## Before Friday's mainnet run (contract developer)

- Add near-workspaces sandbox tests for what unit tests can't cover:
  `on_payout` being private, the real USDC and NEAR Intents round trip, gas.
- Fund the escrow account: it pays storage for orders (about 0.003 NEAR each).
- Keep the checker's private key out of the repo; rotate with `set_checker_pk`.
