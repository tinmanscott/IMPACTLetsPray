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

- **IMPACT branding (matches Be There as a set):** calm dark background, the white IMPACT logo with "✦ Let's Pray" in the header, and IMPACT Blue `#3D59A8`, Green `#4CAD3B` and Orange `#E95E24` as accents. Let's Pray has its own Home Screen icon (the IMPACT rings around a white prayer-light star) so it's never mistaken for Be There
- **Photos:** shown on prayer cards and in the Roster. Admins add them in People; leaders can add or change them from a prayer card (camera button) or by tapping a face in the Roster; students can send their own from the student page, which waits in the Inbox for approval. Only admins can remove a photo
- **Small groups:** create groups in the People tab, assign students and leaders, then filter the Pray deck and Roster by group
- **CAUSE Circle:** each student's list of friends they're praying for to share the Gospel with, with a check-off for "heard the Gospel"
- **Student page (`/submit`):** students send prayer requests and CAUSE Circle names; nothing appears until an admin approves it in the **Inbox** tab
- **Student info updates:** students include their grade and birthday (or send "Just my info"); approving in the Inbox updates the roster, with a checkbox to skip it
- **Student Prayer Wall:** when sending a request, a student can choose to share it on the wall with their first name or anonymously. Nothing posts until an admin approves it. Students tap 🙏 "I prayed" on each other's requests (Prayer Wall tab at `/submit`). Admins can remove posts in the Inbox, and posts drop off after 30 days
- **Gospel conversations:** students log how many Gospel conversations they had, who with, how it went, and the story. After you approve it in the Inbox, it's added to their record (and their friend is marked "heard the Gospel" in their CAUSE Circle). Leaders see the totals and latest story on the prayer card; stories collect in the Report tab; you set a monthly goal in Report → Team Goals. Students see the group's monthly total and goal (numbers only, no names) at the top of the Prayer Wall
- **Parent page (`/parents`):** parents enter a parent code and share family prayer requests. They choose "our IMPACT leaders" (shows on their student's prayer card under "From their family") or "staff only" (confidential), can ask leaders not to mention it to their student, and can ask for a staff member to reach out. Everything waits in the Inbox; confidential requests and follow-ups go to an admin-only list at the bottom of the Inbox. Parents can't see the roster or the student Prayer Wall
- **Teaching series (admin → Teach tab):** series name, artwork, and for each week the message date, title, verse, a prayer prompt, and the parent Think / Read / Ask / Pray. **Paste a weekly recap** fills in a week from your parent recap text. Each week appears on its date: leaders see it at the top of the Pray tab, students see it on the student page, and parents see Think / Read / Ask / Pray at the top of the parent page. The daily reminder adds "This week: (verse)" once you re-paste the reminder Worker
- **Memory verse (each week of the series):** add a reference and the words in Teach → Series, or tap "Same as this week's verse." A recap with a "Memory Verse:" line fills it in too. Leaders see it on the series card. Students can practice by hiding some words, then showing only first letters, and can mark it memorized (saved on their phone only). Parents see it under "practice together." The daily reminder names the memory verse once you re-paste the reminder Worker
- **Leader note (admin → Teach → Leader note):** a weekly devotional or encouragement at the top of every leader's Pray tab, with an optional notification to leaders who have reminders on
- **Answered prayers:** tap ✓ on any prayer request to mark it answered (with an optional update). Students can send **praise reports** (and share them on the Prayer Wall). Admins can mark Prayer Wall requests answered from the Inbox. Everything collects in the leader **Wall → Answered 🎉** view
- **"Someone prayed for you":** students can turn on notifications on the student page. They get one notification a day at most when someone taps 🙏 on their Prayer Wall request, or when a leader marks them prayed (after their first submission is approved)
- **Wall tab (leaders and staff):** one place to pray through what students and parents shared. **Students** shows the approved student Prayer Wall posts plus the Gospel conversation tracker; **Parents** shows the family requests parents chose to share with leaders (last 60 days). Leaders tap 🙏 on each, and the Pray tab shows a "New on the Wall" notice when something new comes in. Confidential parent requests never appear here; they stay in the admin Inbox
- **Check in this week (leader Pray tab):** a short list of students to reach out to: family requests and new prayer requests from the last 7 days, birthdays in the next 7 days, Gospel stories to celebrate, and anyone not prayed for in 2+ weeks. It uses the leader's small group if one is picked. "Checked in" is saved only on that phone and resets each Monday. Admins also see how many parents asked for a call
- **Event prayer focus (admin → Teach → Events):** add camp, retreats or mission trips with dates, a prayer focus, prayer points and who's going (quick-add by HS, MS, small group or leaders). A countdown card appears up to 45 days before and during the event. Leaders can tap "Pray through the N going" to pray through the attendees. Students and parents see the card and how many are going, never the names
- **Monthly recap (admin → Report):** pick a month to see prayers, new requests (including from parents), answered prayers, Gospel conversations, friends who trusted Jesus, and the top stories. "Copy recap as text" lets you paste it into an email, text or staff notes. Request counts begin with this version, so earlier months show fewer
- **Calendar from BAND (admin → Teach → Calendar):** paste the link from BAND's Calendar → Manage Events → **Export Band Calendars**. Events show in a **Calendar** tab for leaders, a Calendar tab on the student page, and "Coming up" on the parent page. They update on their own about every 30 minutes (or tap **Refresh now**). Keep adding and changing events in BAND. You can add a second calendar (such as a leaders Band) and set it to "Leaders only." The link is stored on the server and only admins can see it
- **Staff and multiple groups:** mark any leader as Staff (badge and filter). Leaders can be MS & HS, and anyone can be in several small groups (for example a dGroup and an IMPACT group)
- **My small group:** each leader picks their small group once on the Pray tab; the deck opens to that group, with a one-tap switch to Everyone. Their group is highlighted in the Week tab
- **Streaks and goals:** a weekly team goal, a team streak, a personal daily streak, small group progress, and a Gospel-shared goal (Week tab; admins set goals in Report)
- **Daily reminders:** each leader can turn on a push notification at the time they choose (Week tab)
- **Security:** the app is locked behind sign-in, and passwords are stored only as scrambled hashes

### Who can see what

| Code | Who uses it | What they can do |
|---|---|---|
| **Admin password** | You | Everything: People, Inbox, Report, Import, settings, photos |
| **Team code** | Leaders | Pray tab, Week, Roster: view the roster, mark prayed, add requests |
| **Parent code** | Parents, at `/parents` | Send family prayer requests for approval. Parents can't see the roster or the Prayer Wall |
| **Student code** | Students, at `/submit` | Send prayer requests, CAUSE Circle names, and grade/birthday for approval, and pray on the Prayer Wall. Students can't see the roster |

Sign-ins are remembered for 90 days (leaders), 24 hours (admin), and 180 days (students). Changing a code signs out everyone using the old one.

### After this version deploys (one time)

1. Open the app and sign in with your **existing admin password**. It's upgraded to the secure format automatically.
2. Go to **People → App Settings** at the bottom and **set a team code**. Leaders can't get in until you do.
3. Optional: set a **student code** in the same place, and share `your-app-url/submit` with students.

Photos need no extra setup; they're stored in the same KV namespace as the roster.

**Usage note:** Cloudflare's free plan allows about 1,000 data saves per day across the whole app (each "Mark as Prayed," approval, or 🙏 tap is one). That's plenty for normal use. If a busy youth night ever hits the limit, saves pause until the next day; the Workers Paid plan ($5/month) raises it to a million.

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
