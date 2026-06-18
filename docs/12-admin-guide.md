# Admin Guide — LostFinder (Capcap)

> For **ICCT Colleges Cainta** system administrators.  
> This document covers: how to become an admin, what the admin panels do, daily workflows, and troubleshooting.

---

## Table of Contents

1. [What admins can do](#1-what-admins-can-do)
2. [How to set up an admin account](#2-how-to-set-up-an-admin-account)
3. [Admin Dashboard](#3-admin-dashboard)
4. [Claims Review](#4-claims-review)
5. [All Items](#5-all-items)
6. [Daily workflow checklist](#6-daily-workflow-checklist)
7. [Points and badges reference](#7-points-and-badges-reference)
8. [Security notes](#8-security-notes)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What admins can do

Regular users can report items, claim, message, and earn points. Admins get three extra panels:

| Panel | What it does |
|-------|-------------|
| **Admin Dashboard** | Campus-wide stats (users, reports, pending claims, messages, total points), recent activity feed, quick navigation |
| **Claims Review** | Review ownership claims that could not be auto-approved — approve or deny with an optional message to the claimant |
| **All Items** | See every report on the system, filter/search, resolve pending items, delete inappropriate listings, message the reporter |

Admins also see the **pending claims alert** at the top of the Admin Dashboard whenever there are unreviewed claims.

---

## 2. How to set up an admin account

There is **no "become admin" button** in the app on purpose. Admin promotion is done manually in Supabase to prevent unauthorized escalation.

### Step-by-step

**Step 1 — Create the user account**

Register a normal account through the app (or create one directly in Supabase Auth). Use any email — the email address itself grants no special access.

**Step 2 — Promote to admin in Supabase**

1. Open your project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **Table Editor** → select the `profiles` table
3. Find the row for the user you want to promote (filter by `email` or `username`)
4. Click the `role` cell → change the value from `user` to `admin`
5. Click **Save**

That is the only change needed. The next time that user visits an admin page, the system re-reads their role from the database and grants access.

**Step 3 — Verify**

Log in as that user. You should see three extra links in the left sidebar:
- Admin Panel
- All Items
- Claims Review

If the links do not appear, sign out and sign back in.

### Demoting an admin

Reverse of the above: change `profiles.role` from `admin` back to `user` in Supabase Table Editor. The demotion takes effect on the user's **next admin page navigation** (the system re-verifies the role from the database on every admin panel load, so a mid-session demotion will redirect them automatically).

---

## 3. Admin Dashboard

**Navigate:** Sidebar → **Admin Panel**

### Stats cards

Eight stat cards give a live snapshot of the campus system. Each card is clickable and navigates to the relevant section.

| Card | What it shows | Navigates to |
|------|--------------|-------------|
| Total Users | Number of registered student/staff accounts (excludes admins) | Admin Panel |
| Total Reports | All reports ever submitted | All Items |
| Active Lost | Pending lost item listings | All Items |
| Active Found | Pending found item listings | All Items |
| Resolved | Items that have been returned to owners | All Items |
| Pending Claims | Claims awaiting manual review | Claims Review |
| Messages | Total messages sent on the platform | Messages |
| Total Points | Sum of all points earned by all users | Leaderboard |

### Pending claims alert

If any claim has `pending-review` status, a yellow banner appears above the stats. Click it to go directly to Claims Review.

### Quick action buttons

Four buttons below the stats: **Claims Review**, **All Items**, **Leaderboard**, **Messages** — each shows a live count.

### Recent activity feed

Two side-by-side columns:
- **Recent Reports** — last 6 reports filed, with type, reporter name, and relative time
- **Recent Claims** — last 4 claims submitted, with claimant name and current status

### Top contributors

A leaderboard table showing the top 5 users by points, including their report count.

---

## 4. Claims Review

**Navigate:** Sidebar → **Claims Review** (or click the pending claims alert)

This is the most important admin panel. When a user submits a claim on a found item and their answers do not exactly match the finder's verification hashes, the claim is sent here for manual review.

### Understanding the filter tabs

| Tab | Description |
|-----|-------------|
| **All** | Every claim, all statuses |
| **Pending Review** | Needs your action |
| **Auto-Approved** | System approved automatically (all 3 answers matched) |
| **Approved** | Manually approved by admin |
| **Denied** | Manually denied by admin |

Focus your daily attention on the **Pending Review** tab.

### Reading a claim card

Each card shows:

```
+----------------------------------------------+
| Jansport Backpack            Pending Review  |
| [JD] Juan dela Cruz  — Claimant              |
| Submitted Jun 15, 2026 at 10:32 AM  [3d ago] |
|                                              |
| VERIFICATION RESULT                          |
| [Answers did not match]  [Flagged: vague]    |
| (Answer contents hidden per Blind Verification|
|  Protocol)                                   |
|                                              |
| [Approve & Issue Code]  [Deny]  [Message]    |
+----------------------------------------------+
```

**Verification result** tells you whether the claimant's hashed answers matched the finder's stored hashes. The actual answers are never shown — this is by design (Blind Verification Protocol).

**Vague flag** means the system detected that one or more answers were very short (5 words or fewer), which can indicate a weak or guessed answer.

**Time-ago badge** turns amber and shows "overdue" if the claim has been waiting 2 or more days.

### Approving a claim

1. Click **Approve & Issue Code**
2. Confirm in the browser dialog
3. The system generates a one-time retrieval code (e.g. `LF-ABC123`), marks the report as resolved, and awards +20 points to the finder
4. The retrieval code appears on the claim card — share it with the claimant so they can present it to pick up the item

The claimant has **48 hours** to use the code before it expires.

### Denying a claim

1. Click **Deny**
2. An inline form expands inside the card
3. Optionally type a reason (e.g. "Answers were too vague — contact the finder directly via Messages")
4. Click **Confirm Denial**

If you typed a reason, the system automatically sends it as a message from you to the claimant. The claim is marked `Denied` and removed from the Pending Review tab.

To cancel without denying, click **Cancel**.

### Messaging the claimant

Click **Message Claimant** on any claim card to open a direct chat thread about that specific item. Use this to:
- Ask the claimant for more information before approving or denying
- Explain a denial verbally
- Coordinate a pickup

---

## 5. All Items

**Navigate:** Sidebar → **All Items**

Shows every report (lost and found) across the entire campus, with filtering and search.

### Filter bar

| Control | Options |
|---------|---------|
| **Type** | All Types / Lost / Found |
| **Status** | All Status / Pending / Resolved |
| **Search** | Filters by item name, reporter name, location, or description |

The result count updates live as you type or change filters.

### Actions on each card

| Button | What it does |
|--------|-------------|
| **Message Owner** | Opens a direct chat thread with the person who filed the report |
| **Resolve** | Marks the report as resolved and awards the reporter +20 points (only shown for pending items) |
| **Delete** | Permanently removes the report from the system (requires confirmation) |

### When to resolve manually

Use **Resolve** when you have confirmed the item was returned to its owner outside the normal claim flow — for example, if someone brought the item to the campus SAO desk and the owner picked it up in person.

### When to delete

Delete a report only when it is:
- Spam or a test entry
- Offensive or contains inappropriate content
- A duplicate of another report

Deleting is irreversible. All claims and sighting tips linked to the deleted report are also deleted.

---

## 6. Daily workflow checklist

Run through this each day the system is active:

- [ ] Open **Admin Dashboard** — check the pending claims alert
- [ ] Go to **Claims Review → Pending Review** — action any claims waiting more than 24 hours
  - Approve claims that appear legitimate (even without exact hash match, use judgment)
  - Deny and message the claimant for claims that are clearly wrong
- [ ] Scan **All Items → Pending / Found** — check for listings that have been open more than 7 days with no claim; consider messaging the finder to confirm the item is still available
- [ ] Check **All Items → All / search for "resolved"** — confirm resolved items have actually been handed over (follow up via message if needed)
- [ ] Review the **Recent Reports** feed on the dashboard for anything suspicious (duplicate names, inappropriate descriptions)

---

## 7. Points and badges reference

These are the point values the system awards automatically. Admins cannot manually edit points (by design — changes are made in Supabase Table Editor if needed).

| Action | Points | Who earns |
|--------|--------|-----------|
| Report a lost item | +5 | Reporter |
| Report a found item | +10 | Finder |
| Item resolved (any method) | +20 | Finder or lost-item owner |
| Sighting marked helpful by owner | +10 | Sighting reporter |
| Sighting credited for recovery | +25 | Sighting reporter |

**Badge tiers:**

| Badge | Required points |
|-------|----------------|
| Hero | 100+ |
| Helper | 50+ |
| Contributor | 20+ |
| Beginner | 0+ |

---

## 8. Security notes

### How admin access actually works

Your admin status is stored in `profiles.role = 'admin'` in the Supabase database. The email address you used to register has no special meaning — admin access is granted only by that database column.

The system enforces this at three levels:

| Layer | Enforcement |
|-------|------------|
| **Frontend navigation** | `page()` silently redirects non-admins to the dashboard before any admin section is created |
| **Frontend data load** | Each admin panel re-fetches your role from the database before loading. If your role was changed while you were logged in, you are redirected on your next admin page visit |
| **Database (RLS)** | Supabase Row Level Security uses `is_admin()` on every query — even if someone bypasses the frontend entirely, the database returns empty data for admin-only operations |

### Promoting and demoting admins safely

- Only promote accounts belonging to trusted ICCT staff
- Demote admins who have left the institution promptly — the demotion takes effect immediately at the database level
- Never share the Supabase dashboard credentials

### Data the admin can see vs. cannot see

| Data | Admin access |
|------|-------------|
| All user profiles (name, email, username, points) | Yes — via leaderboard / profiles table |
| All reports (lost and found) | Yes — All Items panel |
| All claims (status, claimant, hash match result) | Yes — Claims Review |
| All messages | Yes — via Supabase Table Editor (not in-app) |
| Claimant's actual verification answers | **No** — answers are hashed; plaintext is never stored |
| User passwords | **No** — Supabase Auth manages these |

---

## 9. Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Admin links not showing in sidebar | Your `profiles.role` is not `admin` | Set `role = admin` in Supabase Table Editor → profiles |
| Redirected to dashboard when clicking admin links | Role revalidation failed — your DB role may have changed | Sign out and sign back in; confirm `profiles.role = 'admin'` in Supabase |
| "Failed to approve claim" error | The `award_points` or `submit_claim` RPC is missing | Run `docs/sql/schema.sql` in Supabase SQL Editor |
| "Failed to deny claim" error | The `updateClaim` RLS policy is not allowing admin updates | Run `docs/sql/schema.sql` in Supabase SQL Editor |
| Claims panel shows no claims | No claims have been submitted yet, or filter is hiding them | Check the **All** tab in Claims Review |
| Retrieval code is shown as "Expired" | The claimant did not use the code within 48 hours | Approve again to generate a new code, or ask them to re-submit the claim |
| Deleted a report by mistake | Deletion is irreversible in the app | Restore via Supabase Table Editor if you have database access |
| Admin Dashboard shows wrong stats | Stale cache | Navigate away and return to reload |

---

## Related documents

| Document | Use when |
|----------|---------|
| [SETUP.md](./SETUP.md) | First-time Supabase setup, SQL migrations, running the app |
| [06-system-design.md](./06-system-design.md) | Understanding the database schema and RLS model |
| [07-system-flows.md](./07-system-flows.md) | How claims, sightings, and messages work end-to-end |
| [11-claim-flow-feedback.md](./11-claim-flow-feedback.md) | Known gaps in the claim verification flow and recommendations |
| [10-deployment.md](./10-deployment.md) | Deploying to production (Vercel / Netlify) |
