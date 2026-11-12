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

## Things to know

- **The free API sleeps after about 15 minutes with no visits.** The next visit wakes it, which takes up to a minute.
  - Open the site a few minutes before you show it.
  - To keep it awake, a free uptime pinger such as UptimeRobot can call `/health` every 10 minutes.
- **The demo data lives in memory.** It resets whenever the API restarts or sleeps.
- **Everyone shares one demo shop.** Visitors can see each other's test orders.
- **This setup is demo only.** Real orders (live mode) need the relayer and checker keys. Those run on your own machine for now; see `services/api/README.md`.
