# Design Recommendations — LostFinder (Capcap)

> Findings and prioritized improvements based on current system design. Architecture: [06-system-design.md](./06-system-design.md). Flows: [07-system-flows.md](./07-system-flows.md).

---

## Executive summary

LostFinder is **production-viable for a campus pilot** with Supabase Auth, shared PostgreSQL data, RLS, Storage, blind claims, sightings, and messaging. The main risks are **monolithic `main.js`**, **client-only verification trust**, **manual message refresh**, and **no automated tests**. Below are actionable recommendations grouped by priority.

---

## Priority legend

| Priority | Meaning |
|----------|---------|
| **High** | Blocks reliability, security, or maintainability soon |
| **Medium** | Improves quality; schedule in next sprint |
| **Low** | Nice-to-have; defer until core is stable |
| **Done** | Already addressed in current codebase |

---

## Architecture and maintainability

### Finding: `main.js` is ~2,200 lines

**Impact:** Hard to navigate, test, and onboard new developers. Matching, UI rendering, and admin logic are intertwined.

**Recommendation:** Split per [02-refactor-recommendations.md](./02-refactor-recommendations.md):

| New module | Move from `main.js` |
|------------|---------------------|
| `js/domain/matching.js` | `calculateMatchScore`, `findMatches`, `scoreSightingTip`, synonyms |
| `js/domain/verification.js` | `simpleHash`, claim hash compare |
| `js/ui/dashboard.js` | `loadDashboard`, insight cache, export triggers |
| `js/ui/messages.js` | Chat panel, conversations, `openChat` |
| `js/ui/admin.js` | Admin panel loaders |

**Priority:** Medium (partially done — `js/domain/matching.js`, `js/domain/verification.js`, `js/ui/messages.js` extracted)

**Impact:** 50+ functions on `window`; inline handlers with `escapeQuotes` for UUIDs/names are fragile.

**Recommendation:** Migrate to event delegation on `document` (pattern already used for `#conversationsList`). Keep `globalFns` during transition.

**Priority:** Low

---

### Finding: No automated tests

**Impact:** Regressions in RLS, matching, or auth flows go unnoticed until manual QA.

**Recommendation:** Add smoke tests (Playwright or Vitest + mocked Supabase):

1. Login with email
2. Create lost report
3. Send message (RLS)
4. Submit sighting (if table exists)
5. Dashboard export produces JSON

**Status:** Vitest unit tests added for matching + verification (`npm test`). E2E tests still recommended.

**Priority:** High (partially done)

---

## Security and trust

### Finding: Blind verification hashes are computed client-side only

**Impact:** A motivated user could bypass hash checks in devtools. Acceptable for campus demo; weak for high-value items.

**Recommendation:**

1. Document threat model in [06-system-design.md](./06-system-design.md) (done)
2. Add RPC `verify_claim_answers(report_id, hashes)` that compares server-side
3. Never return `verify_hashes` to claimants (already hidden in UI)

**Status:** `010_verify_claim_rpc.sql` + client integration with fallback.

**Priority:** Medium (done)

---

### Finding: Sighting verification relies on owner honesty

**Impact:** Owners can dismiss valid tips or self-credit recovery without real return.

**Recommendation:**

- Optional photo proof when marking "Recovered via them"
- Admin dispute queue for contested sightings
- Reporter "helpful" count on profile for reputation

**Priority:** Low

---

### Finding: RLS policies spread across 5 SQL files

**Impact:** Hard to audit; easy to miss a policy after reset/migration.

**Recommendation:**

- Security summary lives in [06-system-design.md](./06-system-design.md) (done)
- Optional: `010_rls_reference.sql` that documents all policies in one file (comments only, or idempotent re-create)

**Status:** `docs/sql/010_rls_reference.sql` added.

**Priority:** Medium (done)

---

### Finding: Message send RLS failures after fresh migration

**Impact:** Users saw "new row violates row-level security policy for table messages".

**Recommendation:** Run [009_fix_messages_rls.sql](./sql/009_fix_messages_rls.sql); `sendMessage` uses `auth.getUser()` for `sender_id`.

**Priority:** Done

---

## UX and reliability

### Finding: Messages do not update in real time

**Impact:** Users must refresh or re-open conversation to see new messages.

**Recommendation:** Subscribe to Supabase Realtime on `messages` where `receiver_id = auth.uid()`; append to `#chatMessages` on insert.

**Status:** `subscribeToMessages` in `js/services/messages.js` + `js/ui/messages.js` controller.

**Priority:** Medium (done)

---

### Finding: Dashboard fails if sightings SQL not applied

**Impact:** Entire dashboard showed error when `sightings` table missing.

**Recommendation:** `safeFetchSightingsForOwner` / `safeFetchMySightings` with warning banner; partial export still works.

**Priority:** Done

---

### Finding: Empty dashboard below stats looks broken

**Impact:** Users think data failed to load when there are simply no matches or tips.

**Recommendation:** Default "Dashboard Insights" empty state with export hint.

**Priority:** Done

---

### Finding: Missing `icon/` image assets

**Impact:** `main.css` references logos/backgrounds that 404; landing/auth branding broken.

**Recommendation:** Add assets under `icon/` or replace CSS with gradient/placeholder.

**Priority:** Low

---

## Operations

### Finding: No dedicated deployment guide

**Impact:** Auth Site URL misconfiguration causes login failures in production.

**Recommendation:** Add `10-deployment.md` covering:

- Vercel / Netlify static deploy
- `npm run config` in CI
- Supabase Auth redirect URLs
- CORS / `file://` warning

**Status:** [10-deployment.md](./10-deployment.md) added.

**Priority:** Medium (done)

---

### Finding: Fresh start requires 10 SQL migrations

**Impact:** Easy to skip a file (e.g. 007 sightings, 009 messages).

**Recommendation:** [000_reset_database.sql](./sql/000_reset_database.sql) + numbered checklist in [SETUP.md](./SETUP.md).

**Priority:** Done

---

## Feature gaps (product flow)

| Gap | Impact | Recommendation | Priority |
|-----|--------|----------------|----------|
| No notification when sighting received | Owner may miss tips | Email via Supabase Edge Function or in-app badge | Medium |
| No reporter reputation beyond points | Low incentive for quality tips | Show verified tip count on profile/leaderboard | Low |
| Admin cannot bulk-export campus insights | Admin dashboard stats only in UI | Extend `downloadDashboardInsights` for admin `platform_reports` CSV | Low |
| Finder cannot chat from claim panel | Extra navigation to message claimant | Add **Message** on claim cards for finder | Low (done — admin claims panel) |
| No full-text search across campus | Search is client-side on current page only | Postgres `tsvector` or Supabase full-text RPC | Low |
| No mobile app / PWA | Browser-only | Add `manifest.json` + service worker | Low (done) |

---

## Recommended roadmap

### Phase A — Stability (1–2 weeks)

1. Run full SQL chain on production Supabase (001–009)
2. Add smoke tests for auth, reports, messages
3. Document deployment ([SETUP.md](./SETUP.md) + future `10-deployment.md`)

### Phase B — Maintainability (2–4 weeks)

1. Extract `js/domain/matching.js` and `js/ui/messages.js`
2. Supabase Realtime for messages
3. Server-side claim verification RPC

### Phase C — Product polish (ongoing)

1. Sighting notifications
2. Admin campus export
3. Reporter reputation
4. PWA manifest

---

## What not to change yet

| Area | Reason |
|------|--------|
| Supabase → custom backend | Current stack fits campus scale |
| React/Vue rewrite | Vanilla JS works; refactor modules first |
| Remove points system | Drives leaderboard engagement |
| Remove blind verification | Core differentiator vs simple bulletin board |

---

## Related documents

| Doc | Use when |
|-----|----------|
| [06-system-design.md](./06-system-design.md) | Understanding architecture |
| [07-system-flows.md](./07-system-flows.md) | QA or onboarding |
| [08-function-reference.md](./08-function-reference.md) | Finding a function |
| [02-refactor-recommendations.md](./02-refactor-recommendations.md) | Detailed module split ideas |
| [SETUP.md](./SETUP.md) | Running and troubleshooting |
