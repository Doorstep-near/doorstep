# Deploying Doorstep (public demo and live app)

The public demo runs on Render's free plan as two services from `render.yaml`:

| Service | What it is | URL |
| --- | --- | --- |
| `doorstep-near` | The web app (static files on Render's CDN) | https://doorstep-near.onrender.com |
| `doorstep-near-api` | The API in `DEMO_MODE` | https://doorstep-near-api.onrender.com |

Demo mode uses a fake chain, a fake 1Click and a mock courier. It needs no keys and moves no money. The seller token is `demo`.

## First deploy

1. Sign in at https://dashboard.render.com with GitHub. Give Render access to the `Doorstep-near/doorstep` repo.
2. Go to **New > Blueprint** and pick the repo. Render reads `render.yaml` and shows both services. Click **Apply**.
3. Wait for both builds to finish (a few minutes).
4. Open https://doorstep-near-api.onrender.com/health. You should see `{"ok":true}`.
5. Open https://doorstep-near.onrender.com and click **Try the demo**.

**If Render renamed a service** because the name was taken, its URL changes. In that case:

1. Set `VITE_API_URL` on the web app to the real API URL, then redeploy it.
2. Set `WEB_URL` on the API to the real web URL.

Every push to `main` redeploys both services.

## The web app on Vercel (optional second host)

`apps/web/vercel.json` builds the website on Vercel. It uses the same API on Render, which allows the Vercel address in `CORS_ORIGINS` (`render.yaml`; currently `https://doorstep-iug1.vercel.app`).

1. Sign in at https://vercel.com with GitHub. Give the Vercel GitHub app access to `Doorstep-near/doorstep`.
2. Go to **Add New > Project** and import the repo.
3. Vercel finds two apps. Click **Import single project** next to **web (Vite)**. Do not use the multi-service import.
4. Fill in:
   - **Project Name:** any name. Vercel picks the address (ours is `doorstep-iug1.vercel.app`).
   - **Root Directory:** `apps/web`.
   - **Environment Variables:** `VITE_API_URL` = `https://doorstep-near-api.onrender.com`
5. Click **Deploy**. Build settings come from `apps/web/vercel.json`.

`VITE_API_URL` must be the **Config** type: Vercel refuses `VITE_` variables as secrets because they are built into the public site. If the address changes, put the new one in `CORS_ORIGINS` in `render.yaml` and push.

## Things to know

- **The free API sleeps after about 15 minutes with no visits.** The next visit wakes it, which takes up to a minute.
  - The GitHub workflow `.github/workflows/keep-demo-awake.yml` calls `/health` every 10 minutes until 25 Nov 2026. GitHub runs scheduled jobs late at busy times, so open the site a few minutes before you show it anyway.
  - Actions minutes are free for public repositories. On a private one, every run counts against the free monthly minutes.
- **Demo deposit addresses are fake on purpose.** They start with `DEMO-NOT-REAL-`, are invalid on every chain, and the payment screen warns in red. Real money can't be sent to them by mistake.
- **The demo data lives in memory.** It resets whenever the API restarts or sleeps.
- **Everyone shares one demo shop.** Visitors can see each other's test orders.
- **The demo is separate from the live app below.** Nothing in the demo touches real money or real keys.

## Live app (real money, NEAR mainnet)

`render.yaml` also defines the real app, using the deployed escrow, real 1Click deposits and real payouts:

| Service | What it is | URL |
| --- | --- | --- |
| `doorstep-near-live-api` | The API on NEAR mainnet (Starter plan, 1 GB disk, Singapore) | https://doorstep-near-live-api.onrender.com |
| `doorstep-near-live` | The web app, built against the live API | https://doorstep-near-live.onrender.com |

It costs about $7.25 a month: the Starter instance plus a 1 GB disk. The static site is free. The API is paid because it needs the disk for its database, and it must never sleep: the scheduler releases payouts and refunds on time.

### Set it up (once)

1. In Render, add a payment method (**Account settings > Billing**).
2. Push `render.yaml`. With Blueprint auto-sync on, Render creates both services. Otherwise open the Blueprint and click **Manual Sync**.
3. Open `doorstep-near-live-api` > **Environment**:
   - **Environment Variables > Add from .env:** paste these lines from your local `.env`: `ESCROW`, `RELAYER_ACCOUNT`, `SHOP_ACCOUNT`, `SHOP_NAME`, `SHOP_ADDRESS`, `SHOP_PHONE` and `SELLER_TOKEN`. Add `ONECLICK_JWT` or `ONECLICK_API_KEY` if you have one. Don't paste `API_PORT`, `WEB_URL`, `DB_PATH` or the key file paths: `render.yaml` sets those for Render.
   - Click **Save, rebuild, and deploy**.
   - **Copy the two key files onto the disk.** Add your SSH key in Render (**Account Settings > SSH Public Keys**), then run:
     ```sh
     H=<service-id>@ssh.singapore.render.com   # the service's SSH address (its Connect > SSH tab)
     echo "mkdir -p /var/data/keys && chmod 700 /var/data/keys; exit" | ssh -tt $H
     scp -s .keys/relayer.json .keys/checker.json $H:/var/data/keys/
     echo "chmod 600 /var/data/keys/*.json; exit" | ssh -tt $H
     ```
     Then redeploy. We don't use Render's Secret Files: for us they arrived split into one file per JSON field.
4. **Stop any live API on your own machine first.** Two backends that send with the same relayer key collide on transaction nonces.
5. Check that it worked:
   - https://doorstep-near-live-api.onrender.com/health returns `{"ok":true}`.
   - `/config` shows `"demoMode":false` and `"network":"mainnet"`.
   - The log has no `Checker key mismatch` and no `relayer` warning.

**If Render renamed a service** because the name was taken, set `VITE_API_URL` on the live web app and `WEB_URL` on the live API to the real addresses, then redeploy both.

### Things to know

- **The database is on the disk,** at `/var/data/doorstep.sqlite`. It survives deploys and restarts.
- **Deploys take the API down for about a minute.** A service with a disk can't run two copies at once.
- **Secrets never go in the repo.** Settings live in the Render dashboard. The two keys live on the disk in `/var/data/keys`, so they also survive deploys.
- **Shops that sign up with a wallet have beta limits:** 25 USDC per order and 10 open orders. On top of that, there's a cap of 30 new on-chain orders an hour across all shops (`render.yaml`).
