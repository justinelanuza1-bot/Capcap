# Function Reference — LostFinder (Capcap)

> Complete inventory of service exports and `main.js` functions. Flows: [07-system-flows.md](./07-system-flows.md).

---

## Service layer (`js/services/`)

### `supabase.js`

| Export | Signature | Purpose |
|--------|-----------|---------|
| `supabase` | `createClient(...)` | Singleton Supabase client (CDN ESM) |

### `auth.js`

| Function | Parameters | Returns | Purpose |
|----------|------------|---------|---------|
| `signUp` | `{ email, password, metadata }` | `{ data, error }` | Register with Auth + user metadata |
| `signIn` | `email, password` | `{ data, error }` | Email/password login |
| `signOut` | — | — | End session |
| `getSession` | — | `session \| null` | Current auth session |
| `getProfile` | `userId` | `profile \| null` | Fetch profile by UUID |
| `ensureProfile` | — | `profile` | RPC: create profile if missing |
| `waitForProfile` | `userId, retries?` | `profile` | Poll profile after signup; fallback ensure |
| `updateProfile` | `userId, updates` | `profile` | Update profile fields |
| `addPoints` | `userId, amount` | `profile` | Increment `profiles.points` |
| `getEmailByUsername` | `username` | `email \| null` | RPC: username → email |
| `checkProfileExists` | `{ username, email, id_number }` | `boolean` | RPC: true if duplicate exists |
| `fetchLeaderboardUsers` | — | `profile[]` | Non-admin users by points desc |
| `fetchAllProfiles` | — | `profile[]` | All profiles (admin) |

### `reports.js`

| Function | Parameters | Returns | Purpose |
|----------|------------|---------|---------|
| `fetchReports` | `{ type?, status?, userId? }` | `report[]` | List reports with optional filters |
| `fetchReportById` | `id` | `report` | Single report |
| `createReport` | `report` | `report` | Insert report |
| `updateReport` | `id, updates` | `report` | Update report fields |
| `deleteReport` | `id` | — | Delete report (admin) |
| `getWeeklyReportCount` | `userId` | `number` | Reports in last 7 days |

### `claims.js`

| Function | Parameters | Returns | Purpose |
|----------|------------|---------|---------|
| `createClaim` | `claim` | `claim` | Insert claim |
| `fetchClaims` | `{ status? }` | `claim[]` | List claims |
| `updateClaim` | `id, updates` | `claim` | Update claim (admin) |
| `fetchClaimById` | `id` | `claim` | Single claim |

### `messages.js`

| Function | Parameters | Returns | Purpose |
|----------|------------|---------|---------|
| `fetchUserMessages` | `userId` | `message[]` | All messages where user is sender or receiver |
| `fetchConversationMessages` | `reportId, userId, otherUserId` | `message[]` | Thread between two users on one report |
| `sendMessage` | `{ report_id, sender_name, receiver_id, message }` | `payload` | Insert message; `sender_id` from `auth.getUser()` |
| `markMessagesAsRead` | `reportId, receiverId` | — | Set `is_read = true` for receiver |
| `fetchMessageCount` | — | `number` | Total messages (admin stats) |

### `sightings.js`

| Function | Parameters | Returns | Purpose |
|----------|------------|---------|---------|
| `createSighting` | `sighting` | `sighting` | Insert sighting tip |
| `fetchSightingsForReport` | `reportId` | `sighting[]` | Tips for one lost report |
| `fetchSightingsForOwner` | `userId` | `sighting[]` | Tips on user's lost reports (with `reports` join) |
| `countSightingsForReport` | `reportId` | `number` | Tip count |
| `fetchSightingById` | `id` | `sighting` | Single sighting |
| `updateSighting` | `id, updates` | `sighting` | Update status/verification (owner) |
| `fetchMySightings` | `userId` | `sighting[]` | Tips submitted by user |
| `safeFetchSightingsForOwner` | `userId` | `{ data, error }` | Non-throwing wrapper for dashboard |
| `safeFetchMySightings` | `userId` | `{ data, error }` | Non-throwing wrapper for dashboard |
| `isSightingsSchemaError` | `err` | `boolean` | Detect missing `sightings` table |

### `storage.js`

| Function | Parameters | Returns | Purpose |
|----------|------------|---------|---------|
| `uploadReportImage` | `userId, reportId, file` | `publicUrl` | Upload to `report-images/{userId}/{reportId}.ext` |
| `uploadSightingImage` | `userId, sightingKey, file` | `publicUrl` | Upload to `report-images/sightings/{userId}/{key}.ext` |

---

## UI helpers (`js/ui/init.js`)

| Function | Purpose |
|----------|---------|
| `populateCategorySelect` | Fill category `<select>` from `CATEGORIES` |
| `renderPointsInfoGrid` | Leaderboard points explanation grid |
| `showLoading` | Spinner in a container |
| `showEmpty` | Empty state message in a container |
| `getBadgeLabel` | Re-export from `constants.js` |

---

## Utilities

### `js/utils/escape.js`

| Function | Purpose |
|----------|---------|
| `escapeHtml` | XSS-safe HTML escaping (`esc` alias in `main.js`) |

### `js/utils/export.js`

| Function | Purpose |
|----------|---------|
| `downloadJson` | Trigger browser download of JSON file |
| `downloadCsv` | Trigger browser download of CSV (UTF-8 BOM) |
| `dashboardInsightsToCsv` | Convert `cachedDashboardInsights` to CSV rows |

### `js/constants.js`

| Export | Purpose |
|--------|---------|
| `CATEGORIES` | Report category list |
| `POINTS` | Point values per action |
| `BADGE_TIERS` | Leaderboard badge thresholds |
| `getBadgeLabel` | Badge string for point total |
| `getUserInitials` | Avatar initials from name |

---

## Application layer (`main.js`)

Functions grouped by domain. **Bold** = exposed on `window` via `globalFns` (HTML `onclick`).

### Navigation and app shell

| Function | Window | Purpose |
|----------|--------|---------|
| `showLanding` | Yes | Show landing page |
| `showLogin` | Yes | Show login form |
| `showRegister` | Yes | Show register form |
| `show` | Yes | Route to login/register |
| `enterApp` | No | Hide auth, show app, load dashboard |
| `page` | Yes | Sidebar navigation + lazy section load |
| `updateSidebar` | No | Render nav, user info, admin links |
| `logout` | Yes | Sign out, return to landing |

### Auth UI

| Function | Window | Purpose |
|----------|--------|---------|
| `register` | Yes | Full signup flow |
| `login` | Yes | Full signin flow |
| `togglePassword` | Yes | Show/hide password field |
| `showAuthAlert` | No | Inline auth form alert |
| `hideAuthAlert` | No | Hide auth alert |
| `setBtnLoading` | No | Button loading state |
| `mapAuthError` | No | User-friendly Supabase auth errors |
| `clearAuthFormErrors` | No | Reset form error styles |
| `validateEmail` | No | Email format check |
| `validatePassword` | No | Min 6 chars |
| `validateUsername` | No | Alphanumeric + underscore, min 3 |

### Matching and scoring (internal)

| Function | Window | Purpose |
|----------|--------|---------|
| `simpleHash` | No | Blind verification hash |
| `levenshtein` | No | Edit distance |
| `stringSimilarity` | No | Normalized similarity 0–1 |
| `extractKeywords` | No | Tokenize text for matching |
| `expandWithSynonyms` | No | Synonym expansion for keywords |
| `calculateMatchScore` | No | Lost vs found score 0–100 |
| `findMatches` | No | Pending found items ≥ 50% for a lost report |
| `getMatchBadge` | No | HTML badge for found-item match |
| `scoreSightingTip` | No | Score sighting against lost report |
| `getSightingMatchLabel` | No | `high` / `possible` / `low` |
| `getSightingMatchBadge` | No | HTML badge for sighting lead |
| `getSightingResultMessage` | No | Post-submit guidance text |
| `getSightingVerificationBadge` | No | Owner verification status badge |
| `renderSightingOwnerActions` | No | Helpful / recover / dismiss buttons HTML |
| `generateRetrievalCode` | No | `LF-XXXXXX` claim code |

### Reports and listings

| Function | Window | Purpose |
|----------|--------|---------|
| `openReportModal` | Yes | Open report form |
| `closeReportModal` | Yes | Close report modal |
| `openReportModalFromNav` | Yes | Nav shortcut to report modal |
| `toggleVerificationQuestions` | Yes | Show/hide found-item Q&A |
| `handleImageUpload` | Yes | Report image preview |
| `submitReport` | Yes | Create report + upload + points |
| `loadLostItems` | No | Fetch and render lost listings |
| `filterLostItems` | Yes | Client-side lost search/filter |
| `renderLostItems` | No | Render lost cards |
| `loadFoundItems` | No | Fetch and render found listings |
| `filterFoundItems` | Yes | Client-side found search/filter |
| `renderFoundItems` | No | Render found cards with match badges |
| `loadMyReports` | No | User's lost/found reports + sightings |
| `showReportTab` | Yes | Toggle lost/found tabs in My Reports |
| `renderReportsList` | No | Render report cards |
| `renderSightingsBlock` | No | Sighting tips under owner's lost reports |

### Claims

| Function | Window | Purpose |
|----------|--------|---------|
| `openClaimModal` | Yes | Open blind verification form |
| `closeClaimModal` | Yes | Close claim modal |
| `submitClaim` | Yes | Hash answers, create claim, resolve if match |

### Sightings and recovery

| Function | Window | Purpose |
|----------|--------|---------|
| `openSightingModal` | Yes | Open sighting tip form |
| `closeSightingModal` | Yes | Close sighting modal |
| `updateSightingMatchPreview` | Yes | Live match score in modal |
| `handleSightingImageUpload` | Yes | Sighting photo preview |
| `submitSighting` | Yes | Create sighting + optional upload |
| `verifySightingOwnership` | No | Validate owner + sighting match |
| `confirmSightingHelpful` | Yes | Mark tip helpful (+10 pts) |
| `creditSightingRecovery` | No | Core recovery credit logic |
| `confirmSightingRecovery` | Yes | Confirm recovery (+25/+20 pts) |
| `dismissSighting` | Yes | Dismiss tip |
| `openRecoveryModal` | Yes | Mark lost item recovered |
| `closeRecoveryModal` | Yes | Close recovery modal |
| `submitLostRecovery` | Yes | Resolve with or without sighting credit |

### Dashboard and export

| Function | Window | Purpose |
|----------|--------|---------|
| `loadDashboard` | No | Stats, tips, matches, cache insights |
| `setDashboardDownloadButtons` | No | Enable/disable export buttons |
| `downloadDashboardInsights` | Yes | Download JSON or CSV |

### Leaderboard and settings

| Function | Window | Purpose |
|----------|--------|---------|
| `loadLeaderboard` | No | Render points table |
| `loadSettings` | No | Populate settings form |
| `saveSettings` | Yes | Update name and contact |

### Admin

| Function | Window | Purpose |
|----------|--------|---------|
| `loadAdminPanel` | No | Campus stats dashboard |
| `loadAllItems` | No | All reports with resolve/delete |
| `loadClaimsPanel` | Yes | Pending claims list |
| `approveClaim` | Yes | Approve claim + resolve + points |
| `denyClaim` | Yes | Deny claim |
| `markResolved` | Yes | Resolve report + points to reporter |
| `deleteReportAdmin` | Yes | Delete any report |

### Messaging

| Function | Window | Purpose |
|----------|--------|---------|
| `showChatPanel` | No | Show/hide chat vs empty state |
| `openMessageModal` | Yes | Alias → `openChat` |
| `openChat` | Yes | Navigate to messages + open thread |
| `closeMessageModal` | Yes | No-op stub |
| `closeChatWindow` | Yes | Close active chat |
| `ensureConversationInList` | No | Placeholder for new threads |
| `highlightActiveConversation` | No | Active state in conversation list |
| `loadConversations` | No | Build conversation sidebar |
| `openConversation` | Yes | Select thread |
| `loadMessages` | No | Render message bubbles |
| `sendMessage` | Yes | Send chat message |
| `sendNewMessage` | Yes | Legacy alias → `openChat` |

### Utilities

| Function | Window | Purpose |
|----------|--------|---------|
| `escapeQuotes` | No | Escape quotes for inline `onclick` strings |

---

## Window-exposed functions (`globalFns`)

These are assigned via `Object.assign(window, globalFns)` for HTML `onclick`:

```
showLanding, showLogin, showRegister, show, register, login, logout, page,
togglePassword, toggleVerificationQuestions, openReportModal, closeReportModal,
handleImageUpload, submitReport, filterLostItems, filterFoundItems,
openClaimModal, closeClaimModal, submitClaim, showReportTab,
openSightingModal, closeSightingModal, handleSightingImageUpload,
updateSightingMatchPreview, submitSighting,
confirmSightingHelpful, confirmSightingRecovery, dismissSighting,
openRecoveryModal, closeRecoveryModal, submitLostRecovery,
saveSettings, loadClaimsPanel, approveClaim, denyClaim,
markResolved, deleteReportAdmin, openMessageModal, openChat, closeMessageModal,
sendNewMessage, openConversation, sendMessage, closeChatWindow,
openReportModalFromNav, downloadDashboardInsights
```

All other `main.js` functions are internal (called from loaders, modals, or other functions).

---

## Service → flow quick map

| User action | Service calls |
|-------------|---------------|
| Login | `getEmailByUsername`, `signIn`, `waitForProfile`, `ensureProfile` |
| Report item | `getWeeklyReportCount`, `createReport`, `uploadReportImage`, `updateReport`, `addPoints` |
| Claim item | `fetchReportById`, `createClaim`, `updateReport`, `addPoints` |
| Send message | `sendMessage` (uses `auth.getUser`) |
| Submit sighting | `createSighting`, `uploadSightingImage` |
| Verify sighting | `fetchSightingById`, `updateSighting`, `updateReport`, `addPoints` |
| Dashboard | `fetchReports`, `safeFetchSightingsForOwner`, `safeFetchMySightings` |
