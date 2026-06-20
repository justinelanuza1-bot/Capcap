# LostFinder — Setup & Configuration

The campus Lost & Found system for ICCT Colleges Cainta. This guide takes you from a fresh clone to a running app backed by Supabase.

---

## 1. Prerequisites

| Tool | Why | Notes |
|------|-----|-------|
| **Node.js 18+** | Runs the dev server and the config generator | `node -v` to check |
| **A Supabase project** | Database, auth, storage, realtime | Free tier is enough — create one at [supabase.com](https://supabase.com) |
| **A modern browser** | The app is a vanilla-JS PWA | Chrome/Edge/Firefox |

No build step or framework is required — the frontend is plain HTML, CSS, and ES modules.

---

## 2. Install

```bash
git clone <your-repo-url> Capcap
cd Capcap
npm install
```

---

## 3. Configure environment

The browser config (`js/config.js`) is **generated from `.env`** — never edit `js/config.js` by hand.

1. Copy the example file:

```bash
copy .env.example .env   # Windows
# cp .env.example .env    # macOS/Linux
```

2. Fill in your Supabase project values in `.env`:

```ini
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key-here
WEEKLY_REPORT_LIMIT=3
APP_ENV=development
```

> Find these under **Supabase → Project Settings → API**. Use the **anon/public** key only.
> **Never** put the `service_role` key in `.env` — it would be exposed in the browser.

3. Generate `js/config.js`:

```bash
npm run config
```

(`npm run dev` also runs this automatically via the `predev` hook.)

---

## 4. Set up the database

1. Open **Supabase → SQL Editor**.
2. Paste the entire contents of [`docs/sql/schema.sql`](./sql/schema.sql) and **Run**.

This single file creates everything in one pass:

- Tables: `profiles`, `reports`, `claims`, `messages`, `sightings`, `notifications`
- The signup trigger that auto-creates a profile
- Blind-verification hashing + the `submit_claim` / `confirm_handover` claim flow
- Row Level Security policies for every table
- The `report-images` storage bucket and its policies
- Realtime for `messages` and `notifications`

> Re-running `schema.sql` is safe — it uses `if not exists` / `drop ... if exists` throughout.
> To wipe everything first, run [`docs/sql/000_reset_database.sql`](./sql/000_reset_database.sql).

---

## 5. Enable authentication

In **Supabase → Authentication → Providers → Email**:

- Enable the **Email** provider.
- Enable **sign-ups**.
- For local testing you may turn **off** "Confirm email" so accounts work immediately.

---

## 6. Create an admin

There is no admin sign-up in the UI — admins are promoted manually for security.

1. Register a normal account through the app.
2. In **Supabase → Table Editor → `profiles`**, find that user.
3. Set its **`role`** column to `admin` and save.
4. Sign out and back in. The sidebar will now show the **Admin** workspace.

---

## 7. Run the app

```bash
npm run dev
```

This serves the app at **http://localhost:8080**. If the port is busy, `live-server` picks the next free port — check the terminal output.

### Optional: run tests

```bash
npm test          # one-off
npm run test:watch
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| **Styles or code look stale after an update** | The app is a PWA with a service worker. Hard-refresh with `Ctrl+Shift+R`. If still stale: DevTools → Application → Service Workers → **Unregister**, then reload. |
| **"Could not find function … in schema cache"** | Re-run `schema.sql`, then run `notify pgrst, 'reload schema';` in the SQL editor. |
| **Notifications / "My Claims" don't update live** | Confirm `notifications` and `messages` are in the **Realtime** publication (the schema adds them; check **Database → Replication**). |
| **"row-level security" errors on insert/update** | Make sure `schema.sql` ran fully and the user is signed in. RLS requires an authenticated session. |
| **Login says profile missing** | The signup trigger creates profiles automatically; the app also self-heals via `ensure_user_profile`. Re-run `schema.sql` if the trigger is absent. |
| **Admin link not visible** | The `profiles.role` must be exactly `admin` (lowercase). Sign out/in after changing it. |

---

## Project structure

```
Capcap/
├── index.html            # App shell (all sections live here)
├── main.js               # App orchestrator + page router
├── main.css              # All styles
├── sw.js                 # Service worker (PWA cache)
├── manifest.json         # PWA manifest
├── .env                  # Your Supabase config (gitignored)
├── js/
│   ├── config.js         # Generated from .env — do not edit
│   ├── constants.js      # Categories, points, badge tiers
│   ├── services/         # Supabase wrappers (auth, reports, claims, …)
│   ├── domain/           # Matching + blind-verification logic
│   └── ui/               # Messages controller, init helpers
├── scripts/
│   └── generate-config.mjs
└── docs/
    ├── SETUP.md          # This file
    ├── USER-GUIDE.md     # How to use the system
    └── sql/
        ├── schema.sql    # Final consolidated database setup
        └── 000_reset_database.sql
```

> `docs/sql/schema.sql` is the single source of truth for the database. The numbered
> migration files in `docs/sql/` are kept only for history — you do **not** need to run
> them on a fresh project.
