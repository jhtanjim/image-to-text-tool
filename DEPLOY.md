# Deploying TextSnap

The site runs as one Docker container (Node + Chromium + LibreOffice + fonts). Any host that runs a Dockerfile works.

## Free & fastest: Vercel (static version, 17 tools)
Vercel serves the **static version** of the site: all browser tools work (Image to Text, PDF to JPG, Merge PDF,
Image to PDF, QR, CSV/Excel, Word to Excel…). Tools that need the server (Office → PDF, Text/HTML → PDF, AI tools)
show "Coming soon". The build is configured in `vercel.json` (`npm run build:static` → `dist/`).

1. Go to **vercel.com** → **Sign up** → **Continue with GitHub**.
2. **Add New… → Project →** import `image-to-text-tool`
   (allow Vercel to access this repo when asked).
3. Leave every setting as it is (Vercel reads `vercel.json`) → **Deploy**. It takes about 1 minute.
4. You get an address like `image-to-text-tool.vercel.app`. Every push to `main` redeploys automatically.
5. *(Optional)* **Settings → Domains** to add your own domain.

> ⚠️ Vercel's free **Hobby plan is for non-commercial use only**: no ads on it.
> When you're ready for AdSense, deploy the same build to **Cloudflare Pages** (free, commercial use allowed):
> Workers & Pages → Create → Pages → Connect to Git → pick the repo →
> Build command `npm run build:static`, Output directory `dist` → Save and Deploy.

To try the static version on your own computer: `npm run build:static`, then open the `dist/` folder with any static server.

## Free: Hugging Face Spaces (all 30 tools)
Free forever, no credit card, 2 CPUs and 16 GB RAM, so every tool works.
Catch: the Space **sleeps after 48 hours without visitors**, and the next visit wakes it in about a minute.
Your address will be `https://<your-username>-textsnap.hf.space`.

**One-time setup (about 10 minutes):**
1. Create a free account at **huggingface.co** (email sign-up).
2. Click your avatar → **New Space**:
   - Space name: `textsnap`
   - SDK: **Docker** → **Blank**
   - Hardware: **CPU basic · Free**
   - Visibility: **Public**
   → **Create Space**.
3. Avatar → **Settings → Access Tokens → Create new token** → type **Write** → name it `github-deploy` → copy it.
4. On GitHub, open your repo → **Settings → Secrets and variables → Actions**:
   - **Secrets** tab → *New repository secret* → Name `HF_TOKEN`, Value = the token you copied.
   - **Variables** tab → *New repository variable* → Name `HF_SPACE`, Value = `<your-hf-username>/textsnap`.
5. Go to the repo's **Actions** tab → **Deploy to Hugging Face** → **Run workflow**.
   After that it runs by itself on every push to `main`.
6. Open your Space on Hugging Face. It shows **Building** (the first build takes about 10 minutes), then **Running**.
7. *(Optional, for AI tools)* Space → **Settings → Variables and secrets → New secret** → `ANTHROPIC_API_KEY`.
   The Space restarts with AI turned on.

Don't share the HF token anywhere else. It only lives in GitHub's encrypted secrets.

## Option A: Railway (paid, about $5–10 a month, never sleeps)

1. **Push your code to GitHub.** Railway deploys whatever is on your `main` branch.
2. Go to **railway.com** and sign in with GitHub.
3. **New Project → Deploy from GitHub repo →** pick `image-to-text-tool`.
   (The first time, Railway asks to be allowed to read your repos. Allow it for this repo only.)
4. Railway finds `railway.json` and builds the `Dockerfile`. **The first build takes about 5–10 minutes**
   because it installs Chromium and LibreOffice. Later builds are faster.
5. Open the service → **Variables**, and add:
   | Name | Value | Needed? |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com | Only for the AI tools |
   | `AI_LIMIT_PER_HOUR` | e.g. `20` | Optional (default 30 per visitor) |
   | `CONVERT_LIMIT_PER_HOUR` | e.g. `100` | Optional (default 120 per visitor) |
   Don't set `PORT`, because Railway sets it automatically. `TRUST_PROXY=1` is already set in the Dockerfile.
6. **Settings → Networking → Generate Domain.** You get an address like `textsnap-production.up.railway.app`.
   To use your own domain (e.g. `textsnap.com`), click **Custom Domain** and add the DNS record Railway shows you.
7. **Settings → Resources:** give it at least **1 GB RAM** (2 GB is better). Chromium and LibreOffice need memory.
8. Open your address and try a few tools. `/healthz` should show `{"ok":true}`.

Every time you push to `main`, Railway rebuilds and redeploys automatically.

## Protect your AI bill
- In **console.anthropic.com → Limits**, set a **monthly spend limit** (e.g. $10) so a busy day can never surprise you.
- The site already limits each visitor (`AI_LIMIT_PER_HOUR`). With `TRUST_PROXY=1`, the limit uses the real visitor
  address added by Railway's proxy, so it can't be bypassed with a fake header.

## Option B: Your own VPS (DigitalOcean, Hetzner, etc.)
On an Ubuntu server with Docker installed (2 GB RAM recommended):
```
git clone https://github.com/jhtanjim/image-to-text-tool.git
cd image-to-text-tool
nano .env                      # add ANTHROPIC_API_KEY=... (optional)
docker build -t textsnap .
docker run -d --restart unless-stopped -p 80:5173 --env-file .env --name textsnap textsnap
```
For HTTPS, put Caddy or nginx in front and keep `TRUST_PROXY=1` (already set in the image).

## Updating
- Railway: push to `main`.
- VPS: `git pull && docker build -t textsnap . && docker rm -f textsnap && docker run ...` (same run command as above).
