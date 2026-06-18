# Refactor Recommendations

This document proposes a **minimal, incremental refactor** that prepares LostFinder for Supabase without a full rewrite. The goal is to separate concerns while keeping the existing UI and user flows intact.

## Principles

1. **Smallest correct diff** — change one layer at a time
2. **Keep vanilla JS** — no framework required for v1 (optional later)
3. **Single swap point** — all `getData`/`saveData` calls become async API calls
4. **Preserve domain logic** — matching, hashing, and scoring stay in the client (or move to Edge Functions later)

## Priority matrix

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Replace data layer with Supabase service | Medium | Enables shared data |
| P0 | Move auth to Supabase Auth | Medium | Real security |
| P0 | Move images to Supabase Storage | Low | Fixes storage quota |
| P1 | Split `main.js` into modules | Medium | Maintainability |
| P1 | Add HTML escaping for all `innerHTML` | Low | XSS prevention |
| P1 | Persist session (Supabase handles this) | Low | UX on refresh |
| P2 | Extract rendering from business logic | Medium | Testability |
| P2 | Add `package.json` + dev server | Low | Developer experience |
| P3 | Adopt a lightweight framework (optional) | High | Long-term scale |

## Recommended file structure (after refactor)

```
Capcap/
├── index.html
├── main.css
├── js/
│   ├── app.js              # Init, navigation, DOMContentLoaded
│   ├── config.js           # Supabase URL, keys, constants
│   ├── services/
│   │   ├── supabase.js     # Supabase client singleton
│   │   ├── auth.js         # signUp, signIn, signOut, getSession
│   │   ├── reports.js      # CRUD for reports
│   │   ├── claims.js       # CRUD for claims
│   │   ├── messages.js     # CRUD + realtime subscription
│   │   └── storage.js      # Image upload/download
│   ├── domain/
│   │   ├── matching.js     # Synonyms, Levenshtein, findMatches
│   │   └── verification.js # simpleHash, claim validation
│   ├── ui/
│   │   ├── dashboard.js
│   │   ├── reports-ui.js
│   │   ├── claims-ui.js
│   │   ├── messages-ui.js
│   │   └── admin-ui.js
│   └── utils/
│       ├── escape.js       # HTML sanitization
│       └── dates.js
├── icon/                   # Add missing assets
├── package.json            # Optional: esbuild or live-server
└── docs/
```

You can adopt this gradually — start with `services/` only and keep one `main.js` that imports from it.

## Refactor 1: Data access abstraction (do this first)

### Problem

`getData` and `saveData` are called **50+ times** across `main.js`. Every feature is tightly coupled to `localStorage`.

### Solution

Introduce a **repository interface** with the same operations, backed first by localStorage (for testing), then by Supabase.

```javascript
// js/services/reports.js
export async function getReports(filters = {}) {
  // Supabase: .from('reports').select('*').eq('status', 'pending')
}

export async function createReport(report) {
  // Supabase: .from('reports').insert(report)
}

export async function updateReport(id, updates) {
  // Supabase: .from('reports').update(updates).eq('id', id)
}
```

### Migration pattern

Replace synchronous calls:

```javascript
// Before
const reports = getData('reports').filter(r => r.type === 'lost');

// After
const reports = await getReports({ type: 'lost', status: 'pending' });
```

All UI functions that read/write data become `async` and use `await`. Show a loading state where needed.

## Refactor 2: Authentication

### Problem

- Passwords stored as `btoa(password)`
- `currentUser` lost on page refresh
- Admin credentials in source code and console logs
- User profile mixed with auth credentials in `users` array

### Solution

| Current | Target |
|---------|--------|
| `register()` writes to `users` localStorage | `supabase.auth.signUp()` + insert into `profiles` |
| `login()` compares `btoa` | `supabase.auth.signInWithPassword()` |
| `currentUser` global | `supabase.auth.getSession()` + `profiles` row |
| `role === 'admin'` on user object | `profiles.role` column + RLS policies |
| `initializeAdminAccount()` | One-time seed via Supabase dashboard or migration SQL |

Remove from client code entirely:
- `password` field on profiles
- `initializeAdminAccount()`
- Admin password in alerts and `console.log`

## Refactor 3: Image handling

### Problem

```javascript
image_url: uploadedImageBase64  // stored in localStorage
```

A few photos can exceed the ~5MB `localStorage` limit for the entire app.

### Solution

```javascript
// On submit
const path = `${userId}/${reportId}.jpg`;
const { data } = await supabase.storage.from('report-images').upload(path, file);
const image_url = supabase.storage.from('report-images').getPublicUrl(path).data.publicUrl;

// In report record
image_url: image_url  // URL string, not Base64
```

Keep `handleImageUpload` for client-side validation (5MB, allowed types); upload on submit instead of storing Base64 in memory long-term.

## Refactor 4: Split the monolith

### Suggested extraction order

| Step | Extract from `main.js` | New file |
|------|------------------------|----------|
| 1 | `SYNONYMS`, `calculateMatchScore`, `findMatches` | `domain/matching.js` |
| 2 | `simpleHash`, claim hash comparison | `domain/verification.js` |
| 3 | `getData`/`saveData` replacements | `services/*.js` |
| 4 | `renderLostItems`, `renderFoundItems`, etc. | `ui/*.js` |
| 5 | `page`, `updateSidebar`, modals | `app.js` |

### Module loading (no build step)

Use ES modules in `index.html`:

```html
<script type="module" src="js/app.js"></script>
```

For local development without CORS issues, use a static server:

```bash
npx serve .
# or
npx live-server --port=8080
```

## Refactor 5: Rendering safety

### Problem

User-generated content is injected via `innerHTML`:

```javascript
container.innerHTML = reports.map(r => `
  <div>${r.item_name}</div>  // XSS if malicious input
`).join('');
```

### Solution

Add a small escape helper and use it everywhere:

```javascript
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

Better long-term: use `document.createElement` + `textContent` for user strings, reserve `innerHTML` for static templates only.

## Refactor 6: Navigation and sidebar

### Problem

- Sidebar HTML exists in `index.html` **and** is rebuilt in `updateSidebar()` — two sources of truth
- Admin sections (`admin-panel`, `all-items`, `claims-panel`) are injected dynamically while user sections are static

### Solution

1. Keep **one** sidebar template in `index.html`
2. Toggle admin link visibility with a CSS class instead of rewriting `innerHTML`
3. Move admin sections into `index.html` (hidden by default) — same pattern as user sections

```html
<a id="nav-admin" onclick="page('admin-panel')" class="admin-only hidden">Admin</a>
```

```css
.admin-only { display: none; }
body.is-admin .admin-only { display: block; }
```

## Refactor 7: Dead code and bugs to fix

| Issue | Location | Fix |
|-------|----------|-----|
| `is_read` never updated | `sendMessage`, `sendNewMessage` | Update on `loadMessages` or use Supabase Realtime |
| Retrieval code 48h expiry | UI text only | Add `expires_at` column; check in RLS or client |
| `showReportTab` uses global `event` | `main.js` ~825 | Pass `tab` as parameter |
| Admin password reset every load | `initializeAdminAccount` | Remove after Supabase Auth |
| Missing `icon/` assets | `main.css` | Add images or update paths |

## Refactor 8: Developer tooling (optional but recommended)

Add a minimal `package.json`:

```json
{
  "name": "lostfinder",
  "private": true,
  "scripts": {
    "dev": "live-server --port=8080",
    "build": "esbuild js/app.js --bundle --outfile=dist/app.js --format=esm"
  },
  "devDependencies": {
    "live-server": "^1.2.2",
    "esbuild": "^0.21.0"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  }
}
```

This aligns with `.vscode/launch.json` (port 8080) and enables the Supabase JS client.

## What NOT to refactor (yet)

- **Smart matching algorithm** — works well client-side; move to Postgres/Edge Function only if performance becomes an issue
- **CSS** — functional and responsive; cosmetic cleanup can wait
- **Inline `onclick` handlers** — replacing with `addEventListener` is nice but not blocking Supabase
- **Full framework migration** — React/Vue adds scope; vanilla JS + modules is enough for v1

## Success criteria

After refactor (pre-Supabase wiring):

- [ ] Zero direct `localStorage` calls outside `services/`
- [ ] `matching.js` and `verification.js` are importable without DOM
- [ ] All user strings escaped before HTML insertion
- [ ] `icon/` assets present or CSS updated
- [ ] App runs on `localhost:8080` via `npm run dev`

After Supabase integration:

- [ ] Two browsers see the same reports
- [ ] Login persists across refresh
- [ ] Images stored in Storage, not DB/localStorage
- [ ] Non-admin users cannot access admin routes (enforced by RLS, not just UI)

See [04-migration-guide.md](./04-migration-guide.md) for the step-by-step swap from localStorage to Supabase.
