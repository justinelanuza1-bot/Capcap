# Migration Guide — Connecting Existing Code to Supabase

This guide maps **every major function** in `main.js` to its Supabase equivalent. Follow the phases in order to avoid breaking the app mid-migration.

## Prerequisites

1. Supabase project created
2. Schema + RLS applied ([03-supabase-integration-plan.md](./03-supabase-integration-plan.md))
3. Storage bucket `report-images` created
4. `@supabase/supabase-js` available (CDN or npm)

### CDN setup (no build step)

Add to `index.html` before your app script:

```html
<script type="module">
  import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
  import { SUPABASE_URL, SUPABASE_ANON_KEY } from './js/config.js';

  window.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
</script>
```

Or bundle via `npm` as described in [02-refactor-recommendations.md](./02-refactor-recommendations.md).

---

## Phase 0: Bootstrap files

Create these files before touching `main.js`:

| File | Purpose |
|------|---------|
| `js/config.js` | URL + anon key |
| `js/services/supabase.js` | `createClient` singleton |
| `js/services/auth.js` | Auth wrappers |
| `js/services/reports.js` | Report CRUD |
| `js/services/claims.js` | Claim CRUD |
| `js/services/messages.js` | Message CRUD + realtime |
| `js/services/storage.js` | Image upload |

### `js/services/supabase.js`

```javascript
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

### `js/services/auth.js`

```javascript
import { supabase } from './supabase.js';

export async function signUp({ email, password, metadata }) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: metadata }
  });
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  return supabase.from('profiles').update(updates).eq('id', userId);
}
```

---

## Phase 1: Auth migration

### Remove

```javascript
function initializeAdminAccount() { ... }  // DELETE entirely
```

### `register()` → Supabase

| Step | Current code | New code |
|------|--------------|----------|
| Validate | Same client-side validation | Same |
| Duplicate check | `users.find(u => u.username === ...)` | Supabase unique constraints return error |
| Create user | `users.push({...}); saveData('users', users)` | `signUp({ email, password, metadata: { username, name, id_number, contact_number, role_label } })` |
| Success | `alert` + `show('login')` | Same; note email confirmation if enabled |

```javascript
async function register() {
  // ... validation unchanged ...

  const { data, error } = await signUp({
    email,
    password,
    metadata: { username, name, id_number: idNumber, contact_number: contact, role_label: role || 'Student' }
  });

  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      alert('❌ Username, email, or school ID already registered.');
    } else {
      alert('❌ ' + error.message);
    }
    return;
  }

  alert('✅ Account created! Check your email if confirmation is required, then login.');
  show('login');
}
```

### `login()` → Supabase

| Step | Current | New |
|------|---------|-----|
| Lookup | `users.find(... btoa(password))` | `signIn(email, password)` — use email; if user enters username, resolve to email first |
| Set user | `currentUser = user` | `currentUser = await getProfile(session.user.id)` |
| Persist | None | Supabase session in localStorage automatically |

```javascript
async function login() {
  const input = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  // Resolve username → email if needed
  let email = input;
  if (!input.includes('@')) {
    const { data } = await supabase.from('profiles').select('email').eq('username', input).single();
    if (!data) { alert('❌ Invalid username or password.'); return; }
    email = data.email;
  }

  const { data, error } = await signIn(email, password);
  if (error) { alert('❌ Invalid username or password.'); return; }

  currentUser = await getProfile(data.session.user.id);
  // ... show app, updateSidebar, page('dashboard') ...
}
```

### Session restore on page load

Replace `initializeAdminAccount()` in `DOMContentLoaded`:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession();
  if (session) {
    currentUser = await getProfile(session.user.id);
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    updateSidebar();
    page('dashboard');
  }
});
```

### `logout()` → Supabase

```javascript
async function logout() {
  if (confirm('Are you sure you want to logout?')) {
    await signOut();
    currentUser = null;
    showLanding();
  }
}
```

---

## Phase 2: Reports migration

### `getData('reports')` replacement patterns

| Function | Current filter | Supabase query |
|----------|----------------|----------------|
| `loadLostItems` | `type=lost, status=pending` | `.from('reports').select('*').eq('type','lost').eq('status','pending')` |
| `loadFoundItems` | `type=found, status=pending` | `.eq('type','found').eq('status','pending')` |
| `loadMyReports` | `userId=currentUser.id` | `.eq('user_id', currentUser.id)` |
| `loadDashboard` (admin) | all reports | `.select('*')` |
| `findMatches` | found + pending | `.eq('type','found').eq('status','pending')` |
| `getWeeklyReportCount` | user reports last 7 days | `.eq('user_id', id).gte('created_at', sevenDaysAgo)` |

### `js/services/reports.js`

```javascript
import { supabase } from './supabase.js';

export async function fetchReports({ type, status, userId } = {}) {
  let query = supabase.from('reports').select('*').order('created_at', { ascending: false });
  if (type) query = query.eq('type', type);
  if (status) query = query.eq('status', status);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createReport(report) {
  const { data, error } = await supabase.from('reports').insert(report).select().single();
  if (error) throw error;
  return data;
}

export async function updateReport(id, updates) {
  const { data, error } = await supabase.from('reports').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getWeeklyReportCount(userId) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { count, error } = await supabase
    .from('reports')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', sevenDaysAgo.toISOString());
  if (error) throw error;
  return count;
}
```

### `submitReport()` changes

```javascript
async function submitReport() {
  // ... validation unchanged ...

  const weeklyCount = await getWeeklyReportCount(currentUser.id);
  if (weeklyCount >= WEEKLY_REPORT_LIMIT) { /* alert */ return; }

  // Create report first (without image) to get ID
  const newReport = await createReport({
    user_id: currentUser.id,
    user_name: currentUser.name,
    type, category, item_name: itemName,
    location, date_reported: date,
    description,
    image_url: '',
    verify_hashes: verifyHashes,
    contact_number: currentUser.contact_number || '',
    status: 'pending'
  });

  // Upload image if present
  if (uploadedImageFile) {
    const imageUrl = await uploadReportImage(currentUser.id, newReport.id, uploadedImageFile);
    await updateReport(newReport.id, { image_url: imageUrl });
    newReport.image_url = imageUrl;
  }

  // Points
  const points = type === 'lost' ? 5 : 10;
  await updateProfile(currentUser.id, { points: currentUser.points + points });
  currentUser.points += points;

  // ... matching for lost reports (use newReport with snake_case fields) ...
}
```

### Field name changes in UI code

When reading report objects from Supabase, update property access:

| localStorage | Supabase |
|--------------|----------|
| `r.userId` | `r.user_id` |
| `r.item_name` | `r.item_name` (same) |
| `r.image_url` | `r.image_url` (now URL, not Base64) |
| `r.verify_hashes` | `r.verify_hashes` (same) |
| `r.created_at` | `r.created_at` (same) |

Use a thin adapter during migration if you want to avoid renaming everywhere:

```javascript
function toLegacyReport(r) {
  return { ...r, userId: r.user_id, userName: r.user_name };
}
```

---

## Phase 3: Claims migration

### `submitClaim()` → Supabase

```javascript
async function submitClaim() {
  // ... read answers, compute hashes (client-side, same as today) ...

  const report = await fetchReportById(reportId);  // from Supabase

  const claim = await createClaim({
    report_id: reportId,
    item_name: report.item_name,
    finder_id: report.user_id,
    claimant_id: currentUser.id,
    claimant_name: currentUser.name,
    answer_hashes: { q1: hash1, q2: hash2, q3: hash3 },
    exact_match: exactMatch,
    vague: isVague,
    status: exactMatch ? 'auto-approved' : 'pending-review',
    retrieval_code: exactMatch ? generateRetrievalCode() : null,
    expires_at: exactMatch ? new Date(Date.now() + 48 * 3600000).toISOString() : null
  });

  if (exactMatch) {
    await updateReport(reportId, { status: 'resolved', resolved_at: new Date().toISOString() });
    await addPoints(report.user_id, 20);
  }
}
```

### Admin claim review

```javascript
async function approveClaimAdmin(claimId) {
  const claim = await updateClaim(claimId, { status: 'approved' });
  await updateReport(claim.report_id, { status: 'resolved', resolved_at: new Date().toISOString() });
  await addPoints(claim.finder_id, 20);
}
```

---

## Phase 4: Messages migration

### `sendMessage()` / `sendNewMessage()`

```javascript
async function sendMessage() {
  const message = input.value.trim();
  if (!message) return;

  await supabase.from('messages').insert({
    report_id: currentChatReportId,
    sender_id: currentUser.id,
    sender_name: currentUser.name,
    receiver_id: currentChatOtherUserId,
    message
  });

  input.value = '';
  // Realtime subscription will append; or call loadMessages()
}
```

### Realtime subscription

```javascript
let messageChannel = null;

function subscribeToMessages(reportId, otherUserId) {
  if (messageChannel) supabase.removeChannel(messageChannel);

  messageChannel = supabase
    .channel(`chat-${reportId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `report_id=eq.${reportId}`
    }, () => loadMessages())
    .subscribe();
}
```

Call `subscribeToMessages` inside `openConversation()`.

### Mark as read

```javascript
async function loadMessages() {
  // ... fetch messages ...
  await supabase.from('messages')
    .update({ is_read: true })
    .eq('report_id', currentChatReportId)
    .eq('receiver_id', currentUser.id)
    .eq('is_read', false);
}
```

---

## Phase 5: Admin panel migration

| Function | Current | Supabase |
|----------|---------|----------|
| `loadAdminPanel` | `getData('users')`, `getData('reports')` | `fetchReports()`, count queries |
| `loadAllItems` | all reports | `.from('reports').select('*, profiles(name)')` |
| `resolveReportAdmin` | `saveData('reports')` | `updateReport(id, { status: 'resolved', resolved_at })` |
| `deleteReportAdmin` | splice + saveData | `.from('reports').delete().eq('id', id)` |
| `loadClaimsPanel` | `getData('claims')` | `.from('claims').select('*').eq('status','pending-review')` |

Admin access is gated by `currentUser.role === 'admin'` in UI **and** RLS `is_admin()` on the server.

---

## Phase 6: Settings & leaderboard

### `saveSettings()`

```javascript
async function saveSettings() {
  await updateProfile(currentUser.id, {
    name, contact_number: contact, role_label: role
  });
  currentUser = await getProfile(currentUser.id);
  updateSidebar();
}
```

### `loadLeaderboard()`

```javascript
async function loadLeaderboard() {
  const { data: users } = await supabase
    .from('profiles')
    .select('name, points, username')
    .eq('role', 'user')
    .order('points', { ascending: false })
    .limit(20);
  // render...
}
```

---

## Phase 7: Image upload service

### `js/services/storage.js`

```javascript
import { supabase } from './supabase.js';

export async function uploadReportImage(userId, reportId, file) {
  const ext = file.name.split('.').pop();
  const path = `${userId}/${reportId}.${ext}`;

  const { error } = await supabase.storage
    .from('report-images')
    .upload(path, file, { upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from('report-images').getPublicUrl(path);
  return data.publicUrl;
}
```

### Update `handleImageUpload`

Store the `File` object instead of Base64:

```javascript
let uploadedImageFile = null;

function handleImageUpload(event) {
  const file = event.target.files[0];
  // ... validation ...
  uploadedImageFile = file;
  // Preview with URL.createObjectURL(file)
}
```

---

## Phase 8: Delete localStorage usage

Search `main.js` for all `getData` and `saveData` calls. When none remain:

1. Remove `getData` / `saveData` functions
2. Remove `btoa` password logic
3. Remove `initializeAdminAccount`
4. Optional: one-time migration script to import existing demo data (see below)

---

## Optional: Import existing localStorage data

Run once in browser console before switching, export data:

```javascript
const exportData = {
  users: JSON.parse(localStorage.getItem('users') || '[]'),
  reports: JSON.parse(localStorage.getItem('reports') || '[]'),
  claims: JSON.parse(localStorage.getItem('claims') || '[]'),
  messages: JSON.parse(localStorage.getItem('messages') || '[]')
};
console.log(JSON.stringify(exportData));
```

Import to Supabase via a Node script using `service_role` key (server-side only). Map numeric `id` fields to new bigint/uuid values. **Users must re-register** unless you migrate auth via Supabase Admin API.

For a campus launch, a **fresh start** in Supabase is usually simpler than migrating prototype localStorage data.

---

## Function checklist

| Function | Migrated | Notes |
|----------|----------|-------|
| `register` | Phase 1 | `signUp` + metadata |
| `login` | Phase 1 | `signIn` + `getProfile` |
| `logout` | Phase 1 | `signOut` |
| `saveSettings` | Phase 6 | `updateProfile` |
| `submitReport` | Phase 2 | + Storage upload |
| `loadDashboard` | Phase 2 | `fetchReports` |
| `loadLostItems` | Phase 2 | filtered fetch |
| `loadFoundItems` | Phase 2 | filtered fetch |
| `loadMyReports` | Phase 2 | by user_id |
| `submitClaim` | Phase 3 | insert claim |
| `loadLeaderboard` | Phase 6 | profiles query |
| `sendMessage` | Phase 4 | insert + realtime |
| `loadConversations` | Phase 4 | messages query |
| `loadAdminPanel` | Phase 5 | admin queries |
| `loadClaimsPanel` | Phase 5 | pending claims |
| `findMatches` | Phase 2 | fetch found, run client-side |
| `getWeeklyReportCount` | Phase 2 | count query or DB trigger |

---

## Testing each phase

| Phase | Test |
|-------|------|
| 1 | Register, login, refresh page — still logged in |
| 2 | Submit lost/found report — visible in second browser |
| 3 | Submit claim — admin sees pending review |
| 4 | Send message — appears without manual refresh |
| 5 | Admin resolve/delete — non-admin cannot via API |
| 6 | Leaderboard updates after points |
| 7 | Upload 2MB image — no localStorage quota error |

---

## Rollback strategy

Keep a `USE_SUPABASE` flag in `config.js`:

```javascript
export const USE_SUPABASE = true;  // false = fall back to localStorage
```

Wrap service calls to allow reverting during development. Remove the flag once stable.
