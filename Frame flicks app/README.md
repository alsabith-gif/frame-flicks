# ClientTrack

A dark-themed CRM/dashboard for freelance video editors to find, track, and close clients. Plain HTML/CSS/vanilla JS, no build step, everything saved to your browser's localStorage.

## How to run it

Because each page's markup lives in its own file, **you cannot just double-click `index.html`** — that opens it as `file://C:/…/index.html`, and browsers block `fetch()` of local files under the `file://` protocol (this is what causes the page to get stuck on "LOADING…" forever). Run it through a tiny local server instead:

**If you have Python installed (most common on Windows/Mac):**
```bash
cd clienttrack
python3 -m http.server 8000
# then open http://localhost:8000 in your browser (not the file path)
```
On Windows this may be `python -m http.server 8000` instead of `python3`.

**If you have Node.js installed:**
```bash
npx serve clienttrack
```

**No command line?** Install the free "Live Server" extension in VS Code, open the `clienttrack` folder in VS Code, right-click `index.html`, and choose "Open with Live Server."

Either way, the address bar should show something like `http://localhost:8000/`, never `file://…`.

## What's inside

- **Prospects** — your main pipeline: search/filter, inline status + pipeline checkboxes, "Compose in Gmail" using your saved scripts, groups.
- **Daily Goals** — set daily/weekly targets, tick off progress, see history.
- **Analysis** — response rate, funnel, pipeline milestones, top platforms/niches, and a few auto-generated insights (all computed locally, no AI call).
- **Income** — track paid/pending projects with monthly + per-client charts.
- **DM Scripts** — 5 starter cold-outreach templates you can edit freely.
- **Follow-ups** — auto-computed due list based on your cadence settings, with tone-based message templates.
- **Tips** — outreach best practices.

Everything else works fully offline with no server needed beyond the static file server above (aside from the Supabase login/sync, which needs a network connection).
