# Deployment Guide — LostFinder (Capcap)

> Static SPA deployed to any HTTPS host, backed by Supabase. For local setup see [SETUP.md](./SETUP.md).

---

## Overview

| Component | Deploy target |
|-----------|---------------|
| Frontend | Vercel, Netlify, GitHub Pages, or any static host |
| API / Auth / DB | Supabase (already hosted) |
| Images | Supabase Storage |

The app has **no Node server in production** — only static files (`index.html`, `main.js`, `js/`, `main.css`).

---

## Pre-deploy checklist

1. Run all SQL migrations (`001`–`010`) on production Supabase — see [SETUP.md](./SETUP.md)
2. Enable **Email** auth provider and sign-ups
3. Create at least one admin user (`profiles.role = 'admin'`)
4. Confirm Storage bucket `report-images` exists (from `003_storage.sql`)
5. Enable Realtime on `messages` (included in `010_verify_claim_rpc.sql`)

---

## Environment variables

Production needs the same variables as local dev:

| Variable | Where used |
|----------|------------|
| `SUPABASE_URL` | `js/config.js` |
| `SUPABASE_ANON_KEY` | `js/config.js` (anon key only — never service role) |
| `WEEKLY_REPORT_LIMIT` | Optional, defaults in generator |
| `APP_ENV` | `production` recommended |

---

## Build step: generate config

`js/config.js` is gitignored and must be generated at deploy time:

```bash
npm run config
```

This reads `.env` (or CI secrets) and writes `js/config.js`.

### CI example (GitHub Actions)

```yaml
- name: Install
  run: npm ci
- name: Generate config
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
    WEEKLY_REPORT_LIMIT: 3
    APP_ENV: production
  run: npm run config
- name: Deploy static files
  run: # upload index.html, main.js, main.css, js/, manifest.json, sw.js
```

---

## Vercel

1. Import the GitHub repo
2. **Framework preset:** Other (static)
3. **Build command:** `npm run config`
4. **Output directory:** `.` (project root)
5. Add environment variables in Vercel dashboard
6. Deploy

### Supabase Auth URLs (required)

In Supabase → **Authentication → URL Configuration**:

| Setting | Example |
|---------|---------|
| Site URL | `https://your-app.vercel.app` |
| Redirect URLs | `https://your-app.vercel.app/**` |

Add localhost URLs too if you test against the same Supabase project locally.

---

## Netlify

1. New site from Git
2. **Build command:** `npm run config`
3. **Publish directory:** `.` (root)
4. Set env vars under Site settings → Environment variables
5. Add `netlify.toml` (optional):

```toml
[build]
  command = "npm run config"
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
```

Update Supabase Auth Site URL and Redirect URLs to your Netlify domain.

---

## GitHub Pages

GitHub Pages serves from a subpath on `*.github.io` unless you use a custom domain.

1. Run `npm run config` with production env
2. Deploy root files to `gh-pages` branch or use Actions
3. If using project pages (`username.github.io/repo/`), you may need a base path — test ES module imports

Supabase Auth: add `https://username.github.io` and full repo URL to Redirect URLs.

---

## Common production issues

| Symptom | Fix |
|---------|-----|
| Login redirects fail | Match Site URL + Redirect URLs in Supabase Auth |
| "Email signups disabled" | Enable sign-ups in Auth → Providers → Email |
| Messages not live-updating | Run `010_verify_claim_rpc.sql`; enable Realtime on `messages` in Supabase dashboard |
| Claim verification RPC error | Run `010_verify_claim_rpc.sql`; app falls back to client hash if RPC missing |
| Blank page / module errors | Do not open `file://` — deploy over HTTPS |
| CORS errors | Supabase anon key is designed for browser use; check project URL matches config |

---

## Security notes

- Only deploy the **anon** key — never the service role key in frontend
- RLS enforces data access; UI admin checks are not sufficient alone
- Rotate keys if exposed; update CI secrets and redeploy

---

## Post-deploy smoke test

1. Register a new user
2. Submit a lost report with photo
3. Second user submits found report → verify smart match on dashboard
4. Send a message between users (both tabs open — should appear via Realtime)
5. Download dashboard JSON export

Automated smoke tests: `npm test` (Vitest domain tests).

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [SETUP.md](./SETUP.md) | Local dev + SQL |
| [06-system-design.md](./06-system-design.md) | Architecture |
| [09-recommendations.md](./09-recommendations.md) | Roadmap |
