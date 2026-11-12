# Thursday runbook: the $2 go/no-go test

Goal: prove that a payment from another chain, sent through 1Click with
`customRecipientMsg`, lands in our escrow and marks the right order Funded.
Then prove the payout into NEAR Intents works. About an hour, under $5.

You need: Node 20+, [near-cli-rs](https://github.com/near/near-cli-rs)
(`npm i -g near-cli-rs`), a named NEAR account with ~6 NEAR, and ~$3 of USDC on
Base or Arbitrum in a wallet you control.

## 1. Set up (10 min)

```bash
cp .env.example .env                                   # fill OWNER, ESCROW, SELLER, BUYER_REFUND
near account import-account                            # if OWNER's key isn't in your keychain yet
node scripts/keys.mjs new --out .keys/checker.json     # put its public_key in CHECKER_PK
node scripts/keys.mjs new --out .keys/buyer.json       # plays the buyer's browser
```

Put your 1Click API key (or JWT) in `ONECLICK_API_KEY` (or `ONECLICK_JWT`),
then `set -a; source .env; set +a` so the Node script can read it.

## 2. Deploy the escrow (10 min)

```bash
bash scripts/deploy.sh all       # create sub-account, deploy + init, register with USDC
```

The wasm in `contracts/escrow/res/` is already built and checked; rebuild with
`bash scripts/build-contract.sh` if you change the contract.

## 3. Create a $2 order

```bash
bash scripts/order.sh create             # 2 USDC, deadline in 24 h; note the order id (1 on a fresh deploy)
bash scripts/order.sh show 1             # status should be "Created"
```

## 4. Pay it through 1Click

```bash
# Preview: checks the order and USDC registration, prints the quote. No money moves.
node scripts/oneclick-test.mjs --escrow $ESCROW --order 1 --from base:USDC --refund-to 0xYourBaseAddress

# Real: prints a deposit address and watches until the end.
node scripts/oneclick-test.mjs --escrow $ESCROW --order 1 --from base:USDC --refund-to 0xYourBaseAddress --go
```

Send exactly the amount it prints to the deposit address, from your wallet, on
that chain. Leave the script running.

- **GO**: it ends with `order 1 is Funded`. Build on 1Click with `customRecipientMsg`.
- **Parked**: the money arrived but didn't match the order (reason shown).
  It's safe in the contract; refund it with `refund_unmatched`.
- **NO-GO**: 1Click refunds you, or the order never turns Funded. Switch to
  the collector fallback in the build plan.

If you closed the script, resume with `--watch <depositAddress>` (add
`--tx-hash <your tx>` to speed it up).

## 5. Test the payout into NEAR Intents (15 min)

```bash
bash scripts/order.sh delivered 1          # buyer's signature -> Delivered
# wait for the complaint window (10 min with COMPLAINT_WINDOW_MS=600000)
bash scripts/order.sh release 1            # pays SELLER inside NEAR Intents
bash scripts/order.sh show 1               # "Released"
bash scripts/order.sh intents-balance $SELLER   # should show 2000000 more
```

If `show` says `Delivered` again after the release, NEAR Intents refused the
deposit and the contract undid the payout (money is safe). Then run
`set_payout_mode` with `"Direct"` as the owner and release again. That pays the
seller's NEAR account directly; the seller must be registered with USDC.

## Other commands

```bash
bash scripts/order.sh refund <id>          # after the deadline, if never delivered
bash scripts/order.sh unmatched            # list parked payments
node scripts/keys.mjs checker --key .keys/checker.json --order <id> --ref borzo:123 --escrow $ESCROW
```
