# LostFinder (Capcap) — Documentation Index

Documentation for **LostFinder**, a campus lost-and-found web app for ICCT Colleges Cainta, backed by **Supabase**.

## What is LostFinder?

A web app that lets students and staff report lost/found items, match listings, verify ownership (blind claims), submit sighting tips, message each other, and earn points on a leaderboard.

## Current state (summary)

| Aspect | Today |
|--------|-------|
| Stack | HTML + CSS + vanilla JS (ES modules), live-server |
| Data | **Supabase** PostgreSQL + Auth + Storage |
| Auth | Supabase email/password; username login via RPC |
| Images | Supabase Storage (`report-images` bucket) |
| Services | `js/services/*.js` — thin Supabase wrappers |
| Domain | `js/domain/matching.js`, `js/domain/verification.js` |
| UI modules | `js/ui/messages.js` (chat + Realtime) |
| Tests | `npm test` — Vitest smoke tests for matching + verification |
| Phases | 0–5 complete (+ sightings, dashboard export, refactor Phase B) |

## Start here

1. **[SETUP.md](./SETUP.md)** — configure Supabase, run SQL, run the app
2. **[06-system-design.md](./06-system-design.md)** — architecture, database, security
3. **[07-system-flows.md](./07-system-flows.md)** — user flows with sequence diagrams
4. **[08-function-reference.md](./08-function-reference.md)** — all functions
5. **[09-recommendations.md](./09-recommendations.md)** — design gaps and roadmap

## Documentation map

| Document | Purpose |
|----------|---------|
| **[SETUP.md](./SETUP.md)** | Operations: env, SQL migrations, auth config, troubleshooting |
| **[06-system-design.md](./06-system-design.md)** | **Current architecture** — stack, ER diagram, RLS, matching, points |
| **[07-system-flows.md](./07-system-flows.md)** | **User flows** — auth, reports, claims, sightings, messages, admin |
| **[08-function-reference.md](./08-function-reference.md)** | **Function inventory** — services + `main.js` |
| **[09-recommendations.md](./09-recommendations.md)** | **Design report** — findings and prioritized improvements |
| **[10-deployment.md](./10-deployment.md)** | **Production deploy** — Vercel/Netlify, Auth URLs, CI config |
| **[12-admin-guide.md](./12-admin-guide.md)** | **Admin guide** — setup, daily workflow, Claims Review, All Items, security, troubleshooting |
| [01-system-overview.md](./01-system-overview.md) | Goals and feature map (legacy sections superseded by 06–09) |
| [02-refactor-recommendations.md](./02-refactor-recommendations.md) | Module split and long-term refactor ideas |
| [03-supabase-integration-plan.md](./03-supabase-integration-plan.md) | Historical schema and field mapping |
| [04-migration-guide.md](./04-migration-guide.md) | localStorage → Supabase migration notes |
| [05-simplified-process.md](./05-simplified-process.md) | Streamlined user flows (summary) |

## Recommended reading order

**New developers / reviewers**

1. SETUP → 06-system-design → 07-system-flows → 08-function-reference

**Planning next work**

1. 09-recommendations → 02-refactor-recommendations → 10-deployment

**Historical context**

1. DEVELOPMENT-PHASES → 03-supabase-integration-plan → 04-migration-guide

## SQL migrations

See [SETUP.md](./SETUP.md) for run order: `000_reset_database.sql` (optional wipe) through `010_verify_claim_rpc.sql`.

## Quick links

- Configure and run: [SETUP.md](./SETUP.md)
- Architecture diagram: [06-system-design.md](./06-system-design.md)
- Claim + sighting flows: [07-system-flows.md](./07-system-flows.md)
