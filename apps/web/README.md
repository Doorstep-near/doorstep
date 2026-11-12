# Doorstep web app

The buyer and seller pages for Doorstep: a buyer pays a real shop with any
crypto on any chain, the money waits in a NEAR escrow contract, and the shop is
paid only after delivery is proven.

Vite 7 · React 19 · TypeScript · Tailwind CSS v4 · React Router 7 · TanStack Query 5.
Every API response is parsed with the shared zod schemas in
[`packages/shared/src/api.ts`](../../packages/shared/src/api.ts).

## 1. Try it with sample data (no backend)

Run from the repo root:

```bash
npm install
npm run dev:mock
```

Open http://localhost:5173. A yellow bar says **“Demo mode — no real money
moves”**. Everything runs in your browser against an in-browser copy of the API
(`src/lib/mock`), seeded with the shop **Eraya Foods (demo)**.

Click through the whole flow in about two minutes:

1. **Landing.** Click **Try the demo**. The seller sign-in opens with the token
   `demo` filled in. Click **Sign in**.
2. **Dashboard.** You see four KPI cards and 9 orders, one in each state.
   Try the **Needs action** tab or search for “cheese”.
3. **New order.** Click **New order**. Fill in an item, a price (try `2.5`; the
   ≈₹ estimate updates live), a phone number, and pick **Hand**. The preview on
   the right shows what the buyer will see. Click **Create pay link**. The share
   sheet shows the pay link, a QR, **Share on WhatsApp** and **Open buyer view**.
4. **Pay as the buyer.** Click **Open buyer view**.
   - Pick **USDC · Base**. A live price appears (“You send ≈ 2.52… USDC on Base”).
   - Enter any 0x address as the refund address.
   - Click **Continue to payment**. Your browser makes a buyer key and you get
     the exact amount, the deposit address with a QR, a countdown, and the
     warning “Send only USDC on Base”.
5. **Simulate the payment.** In **Demo controls** (bottom right), click
   **Advance one step**. The page shows **“Your payment is held safely”** with
   a check animation and your order pass. (Alternatively, tap **I've sent it**,
   use a sample hash and watch Payment seen → Converting → Held safely in about
   8 seconds.)
6. **Track the order.** Click **Track your order**. Click **Advance one step**
   again: the seller “ships” it. Now try **Show delivery pass** (a QR to show at
   the door), **Delivery code** (a 6-digit code), or **I received it**.
7. **Protection window.** After you confirm, a countdown shows how long you can
   still **Report a problem**. Click **Advance one step** to end the window and
   pay the shop. The order shows **Order complete** and a receipt.
8. **Proof.** Open **Details → Public proof page** (`/proof/<id>`) to see every
   on-chain step with its contract method.

Seeded orders you can open directly:

| Page | Shows |
| --- | --- |
| `/pay/demo-mom-gift` | A new pay link (“send something to Mom”) |
| `/o/demo-on-way01` | Out for delivery with a Borzo rider; confirm delivery |
| `/o/demo-window01` | Delivered, protection window running |
| `/o/demo-dispute1`, `/o/demo-refund01`, `/o/demo-expired1` | Dispute, refund and expiry outcomes |
| `/proof/demo-paid-out1` | A completed order's proof page |
| `/seller/orders/demo-to-ship1` | Seller view of a paid order: **Ship it** (Borzo quote → book, tracking, or hand) |

**Reset sample data** is in the demo controls (sample data mode only).

The same sample-data mode is available on any build: when the API can't be
reached, error screens offer **Use sample data instead**, and **Try the demo**
switches to it when the API isn't in demo mode. **Exit** in the demo bar
switches back.

## 2. Run against the real API in demo mode

From the repo root:

```bash
npm run demo
```

This starts the API with `DEMO_MODE=true` on http://localhost:8787 and this app
on http://localhost:5173. Demo mode uses fake 1Click/NEAR/Borzo clients, so no
real money moves, and it seeds its own orders. Then:

1. Open http://localhost:5173 and click **Try the demo**. The seller token in
   API demo mode is always `demo` (prefilled). The dashboard shows the orders the
   API seeds for its demo shop.
2. Create an order, open the buyer view and pay as in steps 3–8 above. **Demo
   controls → Advance one step** calls `POST /demo/orders/:id/advance`.

Against a real (non-demo) API, the same pages talk to NEAR mainnet through 1Click:
the deposit address is real, so only send the exact amount shown.

## Configuration

| Variable | Default | What |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8787` | API base URL |
| `VITE_MOCK` | unset | `1` uses the in-browser API (`npm run dev:mock`) |

The API and the mock are swapped in one place: `api` at the bottom of
[`src/lib/api.ts`](src/lib/api.ts).

## Pages

| Route | Who | What |
| --- | --- | --- |
| `/` | Everyone | Landing: how it works, trust model, live numbers from `GET /stats` |
| `/pay/:id` | Buyer | Pick a token, refund address, deposit view, live payment progress |
| `/o/:id` | Buyer | Status, timeline, delivery pass QR, “I received it”, delivery code, complaint, receipt |
| `/confirm/:id#sig=…` | Seller/courier | Opened from the buyer's delivery-pass QR; confirms delivery |
| `/proof/:id` | Judges, anyone | Every on-chain step with NearBlocks links |
| `/seller/login`, `/seller`, `/seller/new`, `/seller/orders/:id` | Seller | Sign-in, dashboard, new order, order detail |

## The buyer key

`src/lib/buyerKey.ts` makes an ed25519 key in the browser
(`crypto.getRandomValues`, `@noble/ed25519`), stores it per order in
`localStorage` (`doorstep:key:<orderId>`), and signs the exact texts in
`packages/shared/src/messages.ts`. Only the public key (`ed25519:<base58>`) is
sent to the API. The **order pass** link (`/o/<id>#k=<seed>`) is the only
backup: the seed is in the URL fragment, which browsers never send to servers.
Opening it imports the key and strips the fragment.

## Develop

```bash
npm run typecheck -w @doorstep/web
npm run test:web        # vitest + Testing Library (jsdom)
npm run build:web       # production build in apps/web/dist
```

Tests cover the buyer key (RFC 8032 vector, signatures verified with
`@noble/ed25519`), base58, the order-pass round trip, status → copy/timeline
for every order status, token search, a contract test that runs every mock
route through the shared schemas, the pay flow end to end, the order and
confirm pages, the seller screens, the landing and the proof page.

## Layout

```
src/
  styles.css            design tokens (light + dark) and base styles
  App.tsx, main.tsx     router and providers
  lib/                  api client, mock API, buyer key, base58, chains, status copy, query hooks
  components/ui/        design-system components
  components/layout/    page frames, demo banner
  components/order/     transaction list and order facts shared by several pages
  features/             landing, pay, order, confirm, proof, seller, demo controls
```

## Design system

- **Tokens** live in `src/styles.css` (`@theme`). The colours are bg, surface, surface-2, border, text, text-2,
  text-3, brand, brand-strong, brand-soft, on-brand, plus status pairs (waiting, transit, success, danger,
  neutral). Dark mode is a `.dark` class on `<html>`; it follows the OS until you pick a theme.
- **Type:** Inter Variable for text with tabular numbers on every amount; JetBrains Mono for addresses,
  hashes and codes. Both are bundled, so the app makes no external font requests.
- **Shape and motion:** 4-pt spacing, radius 8/12/16, subtle shadows, a 3px brand focus ring, and
  150–200 ms ease-out motion. Reduced-motion settings are respected.
- **Components** live in `src/components/ui`: Button, Field/Input/Textarea/Select, SegmentedControl, Card,
  StatusChip, OrderTimeline, Amount, CopyField, QrCode, Countdown, TokenPicker, Sheet/ConfirmDialog, Toast,
  Skeleton, EmptyState, Banner, ErrorState, ExplorerLink, ThemeToggle and Logo.
