# ClientTrack — Cloud Sync + AI Finder Setup

Two things need to be created once: a Supabase project (stores your data) and
a Cloudflare Worker (keeps your Anthropic key secret and powers AI Finder).
After that, everything just works from any device.

---

## Part 1 — Supabase (data storage + login)

1. Go to https://supabase.com → sign in (or create a free account) → **New project**.
   - Name it something like `clienttrack`.
   - Set a database password (save it somewhere, you won't need it day-to-day).
   - Pick a region close to you (e.g. Singapore/Mumbai).
2. Once the project is ready, go to **SQL Editor** → **New query**.
3. Open `supabase/schema.sql` from this bundle, paste its contents in, click **Run**.
   This creates one table, `app_data`, that stores all your app data.
4. Go to **Authentication → Users** → **Add user** → **Create new user**.
   - Use your own email and a password. This is the login you'll use on the app itself (phone + laptop).
   - Turn OFF "Auto confirm user" only if you want an email confirmation step — for a single-user tool, leave auto-confirm ON so you can log in immediately.
5. Go to **Project Settings → API**. Copy two values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

Keep this tab open — you'll paste these into `js/config.js` in Part 3.

---

## Part 2 — Cloudflare Worker (AI Finder proxy)

You'll need Node.js installed (you already have this from your other projects).

1. Get an Anthropic API key if you don't have one: https://console.anthropic.com → **API Keys** → **Create Key**. Copy it.
2. Open a terminal in the `worker/` folder from this bundle:
   ```bash
   cd worker
   npm install -g wrangler   # skip if you already have wrangler
   wrangler login            # opens a browser to connect your Cloudflare account
   ```
3. Set your Anthropic key as a secret (never goes in code, never in git):
   ```bash
   wrangler secret put ANTHROPIC_API_KEY
   ```
   Paste your key when prompted.
4. Deploy:
   ```bash
   wrangler deploy
   ```
5. Wrangler prints a URL like:
   ```
   https://clienttrack-ai.your-subdomain.workers.dev
   ```
   Copy it — you'll need it in Part 3.

*(Optional hardening later: once your Pages site has a fixed URL, open `worker.js` and change `ALLOWED_ORIGIN = '*'` to your actual site URL, then `wrangler deploy` again. Not required to get it working.)*

---

## Part 3 — Wire the app to both

Open `js/config.js` in the app folder and fill in the three values you copied:

```js
export const SUPABASE_URL = 'https://xxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...your anon key...';
export const AI_WORKER_URL = 'https://clienttrack-ai.your-subdomain.workers.dev';
```

Save the file.

---

## Part 4 — Deploy the site (same as Weliza/Vexlur)

Push the `app/` folder to Cloudflare Pages same way you've done before, or for now to test locally:

```bash
cd app
python3 -m http.server 8000
```

Open `http://localhost:8000`, log in with the email/password you created in Supabase Part 1, step 4. You should see the app load. Add a test prospect, then open the same URL on your phone (once deployed to Pages, use the real URL) and log in — the prospect should already be there.

---

## Notes

- **Data flow:** the app still writes to your browser's localStorage instantly (so it stays fast), and quietly pushes each change to Supabase in the background (about half a second after you stop typing). When you open the app on a new device and log in, it pulls everything down from Supabase first.
- **If sync ever fails** (e.g. you're offline), you'll see a small toast warning — your data is still safe in that device's localStorage and will sync next time you're online and save something.
- **Adding more devices:** just open the site URL and log in with the same email/password. No extra setup per device.
- **Multiple people:** everything here assumes single-user. If you ever want a second login, add another user in Supabase Authentication — they'll share the same data (fine for this "just me" setup, but ask me if you want it split per-person later).
