# LostFinder — User Guide

How to use the campus Lost & Found system. This covers every role: the **Reporter**, the **Claimant**, the **Finder**, and the **Admin**.

---

## Getting started

1. Open the app and **Register** with your name, email, username, and contact number.
2. **Sign in**. You land on your **Dashboard**.
3. Use the **sidebar** to move around. The 🔔 bell (top-left) opens your notifications.

Every account starts as a regular user. Admins are assigned manually (see `SETUP.md`).

---

## The big picture

```
Someone loses an item  ─┐
                        ├─►  Reports it as LOST  ──►  gets Sighting tips, Smart Matches
Someone finds an item  ─┘                            from the community

Finder reports it as FOUND (+ 3 secret verification questions)
        │
Claimant answers the 3 questions  ──►  exact match? ──► VERIFIED + retrieval code
        │                                              "Awaiting handover"
        ▼
Finder (or Admin) confirms the physical handover  ──►  RESOLVED, finder earns points
```

The key idea: **answering the secret questions correctly does not instantly close the case.** It verifies ownership and issues a code. The case only closes when the person holding the item confirms they handed it over.

---

## Role 1 — The Reporter (lost something / found something)

### Report a lost item
1. Click **+ Report New Item** (Dashboard or My Reports).
2. Choose **Lost**, fill in name, category, location, date, and a clear description.
3. Submit. You earn **+5 points**.
4. The system runs a **Smart Match** against found items and shows likely matches.

### Report a found item
1. Click **+ Report New Item**, choose **Found**.
2. Fill in the details, then answer the **3 verification questions** — secret details only the true owner would know (e.g. a scratch, an engraving, what's inside).
   - ⚠️ Make them hard to guess and **don't repeat the answers in the public description or photo**. These are your proof the right person is claiming it.
3. Submit. You earn **+10 points**. Your answers are hashed — nobody can read them.

### Limits
- You can file up to **3 reports per week**.

---

## Role 2 — The Claimant (this is mine!)

1. Go to **Found Items** and open the item you believe is yours.
2. Click **Claim** and answer the 3 verification questions.
3. What happens next depends on your answers:

| Outcome | What you see | Status |
|---------|--------------|--------|
| **All 3 correct** | A **retrieval code** (valid 48h) appears | Verified — *Awaiting handover* |
| **Answers too short / vague** | Sent to an admin to review | Pending review |
| **Answers don't match** | Sent to an admin to review | Pending review |

4. Track everything under **My Claims** — a step tracker shows: *Submitted → Verified → Ready for pickup → Completed*.
5. When verified, coordinate with the finder (use **Message** on the claim) and show your **retrieval code** at pickup. If an admin set a **pickup location**, it's shown on the claim.
6. The case closes once the finder or an admin confirms the handover.

---

## Role 3 — The Finder (you're holding someone's item)

After you report a found item, claims may come in. Watch the 🔔 bell and **My Reports**.

1. Open **My Reports** → the **"Claims on items you found"** panel lists active claims.
2. For a verified claim, ask the claimant for their **retrieval code** before handing the item over.
3. Once you've physically returned the item, click **Confirm Handover**.
   - This marks the report **Resolved** and awards you **+20 points**.

---

## Sightings (helping others)

See something that matches a lost-item report? Send a tip.

1. Open a **Lost Item** and click **Report a Sighting**.
2. Describe what/where you saw it (a photo helps). The system scores how well it matches.
3. The owner is **notified** and reviews your tip:
   - **Helpful** → you earn **+10 points**
   - **Led to recovery** → you earn **+25 points**
   - **Dismissed** → no points

Owners review tips from their **Dashboard** and **My Reports**.

---

## Role 4 — The Admin

Admins get an **Admin** workspace with a tab bar: **Dashboard · Items · Claims · Users**.

### Dashboard
- An **action inbox** surfaces only what needs you: *claims needing review* and *claims awaiting handover confirmation*.
- Two activity feeds show **recent reports** and **recent claims**.

### Claims (the main job)
Open **Claims** and use the status tabs (*Needs review*, *Awaiting handover*, *Completed*, *Denied*). Pending claims are sorted **oldest-first** so nothing ages out.

For each claim you get:
- A **confidence meter** (based on whether the secret answers matched and how detailed they were).
- A **side-by-side comparison** of the found item vs. the claimant's info (answers stay hidden — blind verification).
- The finder's contact block.

Actions:
- **Tag as Match** — verifies the claim, issues a retrieval code, optionally sets a **pickup location**, marks the report *Awaiting handover*, and notifies both parties. (Does **not** resolve yet.)
- **Confirm Handover** — closes the case: report *Resolved*, finder awarded points.
- **Deny** — rejects the claim with an optional reason sent to the claimant.

### Items
Browse/search/filter every report (by type, status, or keyword). You can **Resolve** a pending report manually (for cases handled offline) or **Delete** a report.

### Users
Search all accounts and filter by role (Students / Admins). To promote or demote someone, change `profiles.role` in the Supabase Table Editor.

---

## Notifications & messages

- **🔔 Notifications** — durable, in-app alerts for claims, sightings, and handovers. They update live and link straight to the relevant page.
- **Messages** — real-time chat with a finder, claimant, or sighting reporter about a specific item.

---

## Points & badges

| Action | Points |
|--------|-------:|
| Report a lost item | +5 |
| Report a found item | +10 |
| Item resolved (finder, on handover) | +20 |
| Your sighting marked **helpful** | +10 |
| Your sighting **led to recovery** | +25 |

| Badge | Points |
|-------|-------:|
| 🌟 Beginner | 0+ |
| ✨ Contributor | 20+ |
| 💫 Helper | 50+ |
| ⭐ Hero | 100+ |

See where you rank on the **Leaderboard**.

---

## Quick reference — statuses

**Report:** `Pending` → `Awaiting Handover` → `Resolved`

**Claim:** `Pending Review` → `Verified / Ready for Pickup` → `Completed` (or `Denied`)
