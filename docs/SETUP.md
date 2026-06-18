# Setup Guide — LostFinder + Supabase

Follow these steps once to connect and run the app. **All 5 phases are implemented in code.**

## 1. Create Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **anon public key** (Settings → API)

## 2. Run SQL migrations

**Fastest option (fresh project):** run the single consolidated file [`schema.sql`](./sql/schema.sql) — it contains everything below (001–015) in one script. Then skip to step 3.

Or run the individual migrations in order:

| File | Purpose |
|------|---------|
| [`000_reset_database.sql`](./sql/000_reset_database.sql) | **Optional** — wipe all tables/data for fresh start |
| [`001_schema.sql`](./sql/001_schema.sql) | Tables + triggers |
| [`002_rls.sql`](./sql/002_rls.sql) | Security policies |
| [`003_storage.sql`](./sql/003_storage.sql) | Image storage bucket |
| [`004_admin_messages.sql`](./sql/004_admin_messages.sql) | Admin message stats |
| [`005_auth_rpc.sql`](./sql/005_auth_rpc.sql) | Login username lookup + signup duplicate check |
| [`006_ensure_profile.sql`](./sql/006_ensure_profile.sql) | Fix missing profiles on login |
| [`007_sightings.sql`](./sql/007_sightings.sql) | Sighting tips on lost items |
| [`008_sighting_verification.sql`](./sql/008_sighting_verification.sql) | Owner verifies tips & credits recovery |
| [`009_fix_messages_rls.sql`](./sql/009_fix_messages_rls.sql) | Fix message send RLS errors |
| [`010_verify_claim_rpc.sql`](./sql/010_verify_claim_rpc.sql) | Server-side claim verification + Realtime messages |
| [`011_award_points_rpc.sql`](./sql/011_award_points_rpc.sql) | Award points to other users (sighting recovery, claims) |
| [`012_fix_claims_rls.sql`](./sql/012_fix_claims_rls.sql) | Fix claim submit + auto-resolve found items |
| [`013_fix_claim_hash.sql`](./sql/013_fix_claim_hash.sql) | Fix verify_claim_answers integer overflow |
| [`014_submit_claim_rpc.sql`](./sql/014_submit_claim_rpc.sql) | **Required for claims** — one-shot `submit_claim` RPC |
| [`015_fix_resolve_claim_return.sql`](./sql/015_fix_resolve_claim_return.sql) | Patch resolve RPC return type (if coerce error persists) |

### Fresh start (wipe all data)

1. Run [`000_reset_database.sql`](./sql/000_reset_database.sql) in SQL Editor
2. Re-run `001` through `012` in order
3. Users must **register again** (profiles are deleted; auth accounts remain unless you uncomment Section 8 in the reset script)

## 3. Configure auth (required)

### Enable email signups (fixes "Email signups are disabled")

1. Open your project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **Authentication** → **Providers** → **Email**
3. Turn **ON** these settings:
   - **Enable Email provider** — must be enabled
   - **Enable sign ups** — must be enabled (this is what causes the error when off)
4. For local demo, turn **OFF** **Confirm email** (so users can sign in right after registering)

### URL configuration

**Authentication → URL Configuration:**
- Site URL: `http://localhost:8080`
- Redirect URLs: `http://localhost:8080`

> If you still see "Email signups are disabled", check **Authentication → Settings** (or **Sign In / Providers** in newer dashboards) and ensure sign-ups are not disabled at the project level.

## 4. Create admin user

1. **Authentication → Users → Add user**
   - Email: `admin@icct.edu.ph`
   - Password: choose a secure password

2. **Table Editor → profiles** → set `role` to `admin`

## 5. Configure environment variables

Copy the example env file and add your Supabase credentials:

```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbG...
WEEKLY_REPORT_LIMIT=3
APP_ENV=development
```

Generate the app config (runs automatically with `npm run dev`):

```bash
npm run config
```

This creates `js/config.js` from `.env`. **Never commit `.env` or `js/config.js`** — they are gitignored.

> Get keys from Supabase → **Settings → API** (use the **anon public** key only).

## 6. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080)

> Must use a local server (`npm run dev`). Opening `index.html` directly breaks ES modules.

## 7. Full test checklist

| Test | Expected |
|------|----------|
| Register + login | Works, session persists on refresh |
| Report lost item (Browser A) | Visible on Browser B |
| Report found item with photo | Image from Storage URL |
| Claim correct answers | Auto-approved + retrieval code |
| Claim wrong answers | Pending admin review |
| Send message | Recipient sees it in Messages |
| Leaderboard | Real points from Supabase |
| Settings save | Persists after refresh |
| Admin panel | Campus-wide stats |
| Admin resolve/delete | Works |

## Implementation status

| Phase | Feature | Status |
|-------|---------|--------|
| 0 | Setup, SQL, dev server | ✅ |
| 1 | Supabase Auth | ✅ |
| 2 | Shared reports | ✅ |
| 3 | Claims + images | ✅ |
| 4 | Messages, admin, leaderboard | ✅ |
| 5 | Cleanup (no localStorage, XSS, CSS) | ✅ |

## Deploy to production (Phase 5)

### Option A: Vercel

```bash
npm i -g vercel
vercel
```

Set Supabase Auth Site URL to your Vercel domain (e.g. `https://lostfinder.vercel.app`).

### Option B: Netlify

Drag-and-drop the project folder at [netlify.com/drop](https://app.netlify.com/drop), or connect your GitHub repo.

### Option C: GitHub Pages

Push repo, enable Pages on `main` branch, root `/`.

Update Supabase Auth Site URL to match your deployed URL.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CORS / module errors | Use `npm run dev`, not `file://` |
| Login fails after register | Disable email confirmation in Supabase |
| Image upload fails | Run `003_storage.sql` |
| Admin message count shows 0 | Run `004_admin_messages.sql` |
| Login with username fails | Run `005_auth_rpc.sql` in Supabase |
| **Email signups are disabled** | Supabase → Auth → Providers → Email → enable **Enable sign ups** |
| **Cannot coerce the result to a single JSON object** | Run `006_ensure_profile.sql` — auth user has no `profiles` row |
| Sighting submit fails | Run `007_sightings.sql` in Supabase |
| Sighting verify / recovery fails | Run `008_sighting_verification.sql` in Supabase |
| Dashboard: "more than one relationship" for sightings | Fixed in app — refresh page. Caused by `recovery_sighting_id` (008) + `report_id` (007) both linking sightings ↔ reports |
| "Cannot coerce to single JSON object" on sighting recovery / helpful | Run `011_award_points_rpc.sql` — owners cannot update another user's `profiles.points` via RLS |
| "Cannot coerce to single JSON object" on claim submit | Run `013`, `014`, `015` in Supabase; hard-refresh browser (`Ctrl+Shift+R`). Verify: `select proname from pg_proc where proname = 'submit_claim';` |
| **Message send RLS error** | Run `009_fix_messages_rls.sql`, then sign out and sign in |
| `Invalid API key` | Check `.env` values, then run `npm run config` |

## Project structure

```
Capcap/
├── index.html
├── main.js              # App logic (ES module)
├── main.css
├── js/
│   ├── config.js        # Auto-generated from .env (gitignored)
│   ├── config.example.js
│   ├── services/        # auth, reports, claims, messages, storage, sightings
│   └── utils/escape.js  # XSS protection
├── docs/sql/            # Database migrations
.env.example             # Env template (commit this)
.env                     # Your secrets (gitignored)
scripts/generate-config.mjs
```
