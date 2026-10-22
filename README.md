# Let's Pray

A free, open-source prayer tool for youth ministry leaders. Built to help your team pray intentionally and consistently for every student and leader in your group.

**Built by Jordan Baker** — youth pastor at Calvary Baptist Church in Canton, Michigan.

---

> 👋 If this tool is useful for your ministry, I'd love it if you checked out my resources on Download Youth Ministry. Your support helps me keep building free tools like this one.
>
> **[Browse my resources at DYM →](https://www.downloadyouthministry.com/contributors/jordan-baker)**
>
> If you've used one of my resources from DYM, leaving a review goes a long way. Thank you!

---

## IMPACT Students edition

This copy has been customized for IMPACT Student Ministry. On top of the original app it adds:

- **IMPACT branding:** logo, brand colors, and a matching Home Screen icon
- **Photos:** tap the camera on anyone in the People tab to add a photo; it shows on their prayer card and in the Roster
- **Small groups:** create groups in the People tab, assign students and leaders, then filter the Pray deck and Roster by group
- **CAUSE Circle:** each student's list of friends they're praying for to share the Gospel with, with a check-off for "heard the Gospel"
- **Student page (`/submit`):** students send prayer requests and CAUSE Circle names; nothing appears until an admin approves it in the **Inbox** tab
- **Streaks and goals:** a weekly team goal, a team streak, a personal daily streak, small group progress, and a Gospel-shared goal (Week tab; admins set goals in Report)
- **Daily reminders:** each leader can turn on a push notification at the time they choose (Week tab)
- **Security:** the app is locked behind sign-in, and passwords are stored only as scrambled hashes

### Who can see what

| Code | Who uses it | What they can do |
|---|---|---|
| **Admin password** | You | Everything: People, Inbox, Report, Import, settings, photos |
| **Team code** | Leaders | Pray tab, Week, Roster: view the roster, mark prayed, add requests |
| **Student code** | Students, at `/submit` | Send prayer requests and CAUSE Circle names for approval. Students can't see the roster |

Sign-ins are remembered for 90 days (leaders), 24 hours (admin), and 180 days (students). Changing a code signs out everyone using the old one.

### After this version deploys (one time)

1. Open the app and sign in with your **existing admin password**. It's upgraded to the secure format automatically.
2. Go to **People → App Settings** at the bottom and **set a team code**. Leaders can't get in until you do.
3. Optional: set a **student code** in the same place, and share `your-app-url/submit` with students.

Photos need no extra setup; they're stored in the same KV namespace as the roster.

### Turning on daily reminders (one time, about 5 minutes)

Cloudflare Pages can't run things on a schedule, so a tiny separate Worker sends the reminders.

1. Cloudflare dashboard → **Workers & Pages → Create → Create Worker**. Name it `letspray-reminders` and click **Deploy**.
2. Click **Edit code**, delete what's there, paste the entire contents of [`push-worker/worker.js`](push-worker/worker.js), and click **Deploy**.
3. In the Worker go to **Settings → Bindings → Add → KV namespace**. Variable name `INTERCEDE_KV`, namespace `LETSPRAY_KV` (the same one the app uses). Save.
4. **Settings → Trigger events → Add → Cron trigger**, and enter `*/15 * * * *` (every 15 minutes). Save.

Then each leader opens the **Week** tab and taps **Turn on**. On iPhone the app must be added to the Home Screen first (Share → Add to Home Screen), then opened from there.

If you edit `push-worker/src.js`, run `npm run build:worker` to regenerate `worker.js`, then paste it again.

---

## What It Does

- Prayer card deck — swipe or arrow through your roster one person at a time
- Mark as Prayed — tracks who has been prayed for each week, resets every Monday
- Week tab — see who's been prayed for, upcoming birthdays, and a running streak counter
- Roster tab — public-facing directory filtered by MS, HS, and Leaders
- People tab (admin) — add, edit, and manage your roster
- Import — paste a CSV to bulk-import your roster
- Report tab (admin) — weekly prayer percentages over the last several weeks

---

## Setup (About 15 Minutes)

You will need a free [Cloudflare](https://cloudflare.com) account. Cloudflare hosts the app and stores your data for free.

### Step 1 — Fork this repo

Click **Fork** in the top right of this GitHub page to create your own copy. You'll need to sign up for a free GitHub account.

### Step 2 — Create a Cloudflare KV namespace

This is where your roster data will be stored.

1. Log into [dash.cloudflare.com](https://dash.cloudflare.com) (Create a free Cloudflare account if you don't already have one)
2. In the left sidebar click **Storage & Databases → KV**
3. Click **Create namespace**
4. Name it `LETSPRAY_KV` and click **Add**

### Step 3 — Deploy to Cloudflare Pages

1. In Cloudflare dashboard click **Workers & Pages → Create**
2. Choose **Pages** → **Connect to Git**
3. Select your forked repository
4. Set the build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Click **Save and Deploy**

Wait for the first build to complete (about 1 minute).

### Step 4 — Bind your KV namespace

1. Go to your new Pages project → **Settings → Bindings**
2. Click **Add** → **KV Namespace**
3. Set variable name: `INTERCEDE_KV`
4. Select your `LETSPRAY_KV` namespace from the dropdown
5. Click **Save**
6. Go to **Deployments** and click **Retry deployment** (needed for the binding to take effect)

### Step 5 — Open your app and complete setup

Your app is now live at a URL like `your-project.pages.dev`.

When you open it for the first time you'll see a setup screen. Enter:
- Your **ministry name** (e.g. "First Baptist Students")
- An optional **subtitle** (e.g. "Let's Pray" or leave blank)
- An **admin password** — this protects the People, Report, and Import tabs

That's it. Start adding your people.

---

## Using the App

### Adding People

Go to the **People** tab (requires admin login — tap "admin" at the bottom of the screen and enter your password).

You can add people one at a time using the form at the top, or import a whole roster using the **Import** tab.

**Importing from CSV:** Your CSV needs at least a first name and last name column. Birthdays can be in MM-DD, YYYY-MM-DD, or month name formats. The app will auto-detect the columns.

### Praying

Open the **Pray** tab. Swipe through cards or use the arrows. Tap **Mark as Prayed** when you've prayed for someone. The list resets every Monday at midnight Eastern Time.

### Admin Access

Tap the small **admin** link at the bottom of the screen and enter your password. This unlocks the People, Report, and Import tabs. Your session lasts 24 hours.

To lock the admin view, tap **lock admin** at the bottom.

---


## License

Free to use, modify, and deploy for your ministry. Please don't resell it.

If you improve it in a meaningful way and want to share back, open a pull request — I'd love to see it.

---

*Built with React + Vite, deployed on Cloudflare Pages, data stored in Cloudflare KV.* IMPACT edition additions are in `functions/api/`, `lib/`, and `push-worker/`.
