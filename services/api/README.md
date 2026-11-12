# Doorstep API

Fastify + TypeScript backend. It creates orders on the escrow contract, gets
1Click deposit addresses, books couriers, proves delivery with the checker key,
and releases or refunds on time. The HTTP contract is
[`packages/shared/src/api.ts`](../../packages/shared/src/api.ts).

## 1. Try it in demo mode (no keys, no network)

1. Install once at the repo root: `npm install`.
2. Start the API and the web app together: `npm run demo` (repo root).
   You should see:
   ```
   Doorstep API on http://localhost:8787 (DEMO MODE: fake chain, fake 1Click, mock courier, no network)
   Seller token: demo
   ```
3. Open http://localhost:5173, sign in as the seller with token `demo`.
   You should see the shop "Eraya Foods (demo)" with three orders: Draft, Funded and Released.
4. Create an order, open its pay link as the buyer, and pay. Or move any order
   one step at a time:
   ```bash
   curl -X POST http://localhost:8787/demo/orders/<id>/advance
   ```
   Each call moves: Draft → Created (with a quote) → Funded → Shipped (courier booked)
   → picked up → Delivered (checker-signed) → Released (skips the complaint window).
5. Or pay "for real" in demo: ask for a real quote, then
   `POST /orders/<id>/deposit` with any tx hash. About 10 s later the fake 1Click
   reports SUCCESS and the order turns Funded.

Demo mode keeps everything in memory (restart = fresh seed data). The fake
escrow runs the contract's state machine and checks buyer and checker
signatures with real ed25519, so the web app's signing is exercised for real.
The complaint window is `DEMO_COMPLAINT_WINDOW_MS` (2 minutes); after it, the
scheduler releases Delivered orders by itself.

API only: `npm run dev:demo -w @doorstep/api`. A few calls:

```bash
curl http://localhost:8787/config
curl -H 'Authorization: Bearer demo' http://localhost:8787/seller/orders
curl -H 'Authorization: Bearer demo' http://localhost:8787/seller/summary
```

## 2. Run it for real (NEAR mainnet)

You need the escrow deployed and registered with USDC (see
[`scripts/README.md`](../../scripts/README.md); this was done on 12 Nov, see
[`scripts/TEST-RESULTS.md`](../../scripts/TEST-RESULTS.md)).

1. Fill `.env` (copy from `.env.example`): `ESCROW`, `SELLER` (the shop's
   account, or `SHOP_ACCOUNT`), `SELLER_TOKEN` (a long random string),
   `SHOP_NAME`, `SHOP_ADDRESS`, `SHOP_PHONE`.
2. Checker key: `.keys/checker.json` from `node scripts/keys.mjs new --out .keys/checker.json`.
   Its public key must be the contract's `checker_pk`; the API warns at startup if not.
3. Relayer key: `bash scripts/add-relayer-key.sh`. It writes `.keys/relayer.json`
   (mode 0600, prints only the public key) and adds it to `RELAYER_ACCOUNT` as a
   function-call key limited to the escrow's relayer methods. **It sends a
   mainnet transaction** and asks before sending. The contract's relayer
   (`get_config.relayer`) must be that account.
4. Optional, for Borzo: `BORZO_AUTH_TOKEN` and `BORZO_CALLBACK_SECRET` from the
   Borzo cabinet (test environment by default), and set the callback URL there
   to `https://<your-api>/webhooks/borzo` (it must be public, e.g. a tunnel).
5. Optional: `ONECLICK_API_KEY` or `ONECLICK_JWT` (without one, 1Click adds 0.1%).
6. Start: `npm run dev:api` (or `npm run start -w @doorstep/api`).
   Startup prints one line per missing piece (`WARNING: ...`) and checks the
   contract: checker key, relayer, USDC registration, complaint window.
7. Check: `curl http://localhost:8787/config` shows your escrow and window.

## 3. What each route does

| Route | What happens |
| --- | --- |
| `POST /seller/orders` | Saves a Draft (no chain call yet) and returns the pay link. |
| `POST /orders/:id/buyer` | The buyer's browser sends its public key; the relayer calls `create_order`. Same key again: no-op. Another key: 409. |
| `POST /orders/:id/quote` | `dry: true` previews the price. `dry: false` first checks: order on chain and Created, deadline ≥ 40 min away, on-chain price/seller match, escrow registered with USDC, USDC on NEAR listed by 1Click. Then asks 1Click (EXACT_OUTPUT, recipient = escrow, `customRecipientMsg` = chain order id) and stores the signed quote. |
| `POST /orders/:id/deposit` | Passes the buyer's tx hash to 1Click (speeds it up). |
| `GET /orders/:id` | DB + `get_order` + 1Click status (each refreshed at most every 5 s). On 1Click SUCCESS it reads the order: Funded → done (fund tx recorded); not Funded → looks for a parked payment and explains it in `payment.issue`. |
| `POST /orders/:id/confirm`, `/complaint` | Checks the buyer's signature locally, then the relayer submits it. |
| `POST /orders/:id/otp` | Buyer-signed; returns a fresh 6-digit code (10 min, salted hash stored, max 5 per 10 min). |
| `POST /seller/orders/:id/otp/verify` | Seller types the code; 5 tries; on success the checker signs and submits `confirm_by_checker`. |
| `POST /seller/orders/:id/ship/quote`, `/ship` | Borzo price / booking (`borzo:<id>`), tracking (`track:<carrier>:<number>`) or `hand`; then `mark_shipped`. Needs Funded. |
| `POST /webhooks/borzo` | Checks `X-DV-Signature` (hex HMAC-SHA256 of the raw body), re-fetches the order from Borzo, and only a drop point with delivery status `finished` triggers the checker. |
| `POST /webhooks/ship24` | Bearer secret; `statusMilestone: "delivered"` triggers the checker. |
| Scheduler (every minute) | Releases Delivered orders after the window, refunds Funded/Shipped (and expires Created) after the deadline, syncs active orders, polls 1Click. Each order is leased in SQLite first and re-read on chain, so two schedulers never pay twice. |

## 4. Tests

```bash
npm run test:api                    # vitest, no network (RPC, 1Click, Borzo are stubbed)
npm run typecheck -w @doorstep/api
```

They cover every money path: quote safety refusals, relayer method/args/gas,
the checker signature against the contract's exact text (fixed key), Borzo
signature accept/reject, OTP limits, the scheduler run twice at once (one
release), and a demo end-to-end run over HTTP parsed with the shared schemas.

## 5. Code map

| File | Role |
| --- | --- |
| `src/index.ts` | Entry: loads `.env`, wires demo or live, starts HTTP + scheduler. |
| `src/setup.ts` | Builds dependencies (fakes for demo, real clients for live) and startup checks. |
| `src/routes.ts`, `src/app.ts` | HTTP routes, seller auth, CORS, raw body for webhooks, errors. |
| `src/service.ts` | All order logic (views, quotes, shipping, codes, confirmations, payouts). |
| `src/scheduler.ts` | Release / refund / sync / poll loop. |
| `src/near/` | `escrow.ts` (contract interface + live), `relayer.ts` (near-api-js, one queue), `rpc.ts` (views), `fake-escrow.ts` (demo). |
| `src/oneclick/` | 1Click client and the demo fake. |
| `src/borzo/` | Borzo client, signature check, demo mock. |
| `src/checker.ts`, `src/ed25519.ts` | Checker signing; ed25519 with `node:crypto`. |
| `src/db.ts` | SQLite via built-in `node:sqlite` (no native build). |
| `src/demo.ts` | Demo seed data and the advance button. |

Secrets (`.env`, `.keys/`) are read at runtime only and never logged; logs
never include full phone numbers or addresses.
