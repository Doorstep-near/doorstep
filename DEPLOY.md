# Deploying the public demo

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
  - Open the site a few minutes before you show it.
  - To keep it awake, a free uptime pinger such as UptimeRobot can call `/health` every 10 minutes.
- **The demo data lives in memory.** It resets whenever the API restarts or sleeps.
- **Everyone shares one demo shop.** Visitors can see each other's test orders.
- **This setup is demo only.** Real orders (live mode) need the relayer and checker keys. Those run on your own machine for now; see `services/api/README.md`.
