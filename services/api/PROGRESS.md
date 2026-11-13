# Backend progress

Step 1: Fastify server with env config (repo-root .env loaded, never printed), CORS for WEB_URL, shared ApiError errors, GET /health, /config, /stats, SQLite (node:sqlite) data layer, seller Bearer auth (constant-time).
Tests: meta routes, error shape, auth on every /seller route.
Step 2: POST/GET /seller/orders, GET /seller/orders/:id, public GET /orders/:id (phone masked, area only), POST /orders/:id/buyer (Draft -> relayer create_order, idempotent per key, 409 for another key, retry after a failed call).
Tests: create/list/filter/validation, masking, concurrent registration makes exactly one create_order.
Step 4: 1Click client: /tokens (10 min cache, popular flags), dry and real quotes with the script's exact request and safety checks, /orders/:id/deposit, status polling on GET (5 s cache) and SUCCESS -> get_order -> Funded + fund tx, or parked payment surfaced as payment.issue.
Tests: every quote refusal (not on chain, not Created, <40 min, USDC not registered, USDC missing from tokens, unknown token, mismatch, bad echo, payment in progress, Draft), exact request body, fund tx = last NEAR tx.
Step 5: Relayer: near-api-js Account with a function-call key from RELAYER_KEY_FILE, one serial queue, 30 Tgas (100 for release/refund), contract panics -> chain_error with the panic text; tx hashes stored as TxRecords.
Tests: method/args/gas for all 7 calls, order id from return value or event, queue never runs two txs at once, error cleaning.
Step 3: Demo mode (npm run dev:demo, root npm run demo): fake escrow with the contract's state machine and real ed25519 checks, fake 1Click (≈price×1.0103, status moves to SUCCESS ~10 s after a deposit, then funds the order), mock Borzo, seeded "Eraya Foods (demo)" with Draft/Funded/Released orders, POST /demo/orders/:id/advance, seller token "demo".
Tests: HTTP e2e create -> real-key buyer -> dry/real quote -> deposit -> Funded -> advance x4 -> Released (every response parsed with shared schemas), advance-only walk, buyer confirm/complaint signatures, seeded data.
Step 6: Checker: key from CHECKER_KEY_FILE (JWK or NEAR format), signs messages.checker(...) and submits confirm_by_checker; startup warns if its key differs from get_config.checker_pk. Triggers: signed Borzo webhook (re-fetches the order, acts only on "finished"), buyer-signed 6-digit code (salted scrypt hash, 10 min, 5 tries, 5 reveals/10 min), Ship24 webhook (Bearer secret, statusMilestone "delivered").
Tests: fixed-key checker signature verified against the exact contract text and scripts/lib/near.mjs, RFC 8032 vector, Borzo HMAC accept/reject, webhook acts only on re-fetched "finished", OTP expiry/tries/reveal limits/buyer-only, Ship24 auth.
Step 7: Borzo client (calculate-order, create-order, orders?order_id=) on the test API by default; ship quote, ship via borzo ("borzo:<id>"), tracking ("track:<carrier>:<number>") or hand ("hand"), then mark_shipped; shipping needs Funded; one booking per order even on double click.
Tests: request body/pickup/drop/auth header, mark_shipped args, unpaid refused, double click books once.
Step 8: Scheduler (every minute, 3 s in demo): releases Delivered orders after the window, refunds Funded/Shipped and expires Created past the deadline, expires stale Drafts, syncs active orders, polls 1Click. Per-order SQLite leases, re-read get_order before each call, "already final" errors count as success.
Tests: two concurrent ticks (and two schedulers) -> exactly one release; no early release; follows a chain Disputed; refund once with 100 Tgas; Created -> Expired; Delivered never refunded; payment polling.
Step 9: GET /orders/:id and /seller/orders/:id merge DB + get_order + 1Click status (5 s caches); /seller/orders refreshes stale active orders; /seller/summary reads intents.near mt_balance_of for the shop.
Tests: chain Funded shows up on GET; summary held/intents balance.
Step 10: README (demo first, then live setup, route table, tests, code map); every new env var documented in .env.example; scripts/add-relayer-key.sh (it asks before sending the add-key transaction; run on 13 Nov, and the key was checked on chain).
Checked by hand: live mode boots against mainnet read-only (checker key matches, USDC registered, /tokens and a dry 1Click quote work, intents balance read); demo boots via npm run dev:demo with CORS for the web app.
