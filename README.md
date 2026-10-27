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
- **Page addresses:** `impactletspray.app` is a home page with buttons for Students, Parents and Leaders. **`/students`** is open to anyone (no code) with tabs for **Share**, **Lesson** (this week's message, memory verse practice, and earlier weeks), **Devos**, **Calendar** and **Wall** (Prayer Wall); the Calendar and Prayer Wall ask for the student code once per phone. **`/parents`** (parent code) has **Lesson**, **Devos**, **Share**, **Calendar** and **Wall**. **`/leaders`** is the leader sign-in (each leader’s own code) and **`/admin`** is the admin sign-in. Old `/submit` links still work. Nothing students share appears until an admin approves it in the **Inbox**, and one phone can send at most 10 things an hour
- **Daily devos (Devos tab for students, parents and leaders):** in Teach → Series, open a week's **Daily devos** and add up to 6 days (Day 1 = the Monday after the Sunday message). Each day has four parts: **Scripture passage** (the reference, plus the passage text if you paste it in; the reference opens on Bible Gateway, ESV), **Think**, **Respond** and **Pray**. You can paste them all at once: start each with "Day 1" (or "Monday") and use Scripture: / Think: / Respond: / Pray: lines. Today's devo opens first, and people can check off the ones they've done (saved on their phone). Each "I did today's devo" tap is counted (numbers only, split into students, parents and leaders); leaders see the counts on the Devos tab and the Monthly Recap includes devos done
- **Be There link:** the home page has a Be There button, and the Calendar tab for students, parents and leaders starts with a card inviting students and parents to add games, concerts and performances on Be There so leaders can come support them. It opens impactbethere.app. To change the address, edit `BE_THERE_URL` in `src/App.jsx`
- **Lessons tab (leaders):** every week of the current series, including what parents got (Think / Ask / Pray)
- **Student info updates:** students include their grade and birthday (or send "Just my info"); approving in the Inbox updates the roster, with a checkbox to skip it
- **Student Prayer Wall:** when sending a request, a student can choose to share it on the wall with their first name or anonymously. Nothing posts until an admin approves it. Students tap 🙏 "I prayed" on each other's requests (Prayer Wall tab at `/students`, unlocked with the student code; parents can see and pray too). Admins can remove posts in the Inbox, and posts drop off after 30 days
- **Gospel conversations:** students log how many Gospel conversations they had, who with, how it went, and the story. After you approve it in the Inbox, it's added to their record (and their friend is marked "heard the Gospel" in their CAUSE Circle). Leaders see the totals and latest story on the prayer card; stories collect in the Report tab; you set a monthly goal in Report → Team Goals. Students see the group's monthly total and goal (numbers only, no names) at the top of the Prayer Wall
- **Parent page (`/parents`):** parents enter a parent code and share family prayer requests. They choose "our IMPACT leaders" (shows on their student's prayer card under "From their family") or "staff only" (confidential), can ask leaders not to mention it to their student, and can ask for a staff member to reach out. Everything waits in the Inbox; confidential requests and follow-ups go to an admin-only list at the bottom of the Inbox. Parents can't see the roster or the student Prayer Wall
- **Teaching series (admin → Teach tab):** series name, artwork, and for each week the message date, title, verse, a prayer prompt, and the parent Think / Read / Ask / Pray. **Paste a weekly recap** fills in a week from your parent recap text. Each week appears on its date: leaders see it at the top of the Pray tab, students see it on the student page, and parents see Think / Read / Ask / Pray at the top of the parent page. The daily reminder adds "This week: (verse)" once you re-paste the reminder Worker
- **Memory verse (each week of the series):** add a reference and the words in Teach → Series, or tap "Same as this week's verse." A recap with a "Memory Verse:" line fills it in too. Leaders see it on the series card. Students can practice by hiding some words, then showing only first letters, and can mark it memorized (saved on their phone only). Parents see it under "practice together." The daily reminder names the memory verse once you re-paste the reminder Worker
- **Leader note (admin → Teach → Leader note):** a weekly devotional or encouragement at the top of every leader's Pray tab, with an optional notification to leaders who have reminders on
- **Answered prayers:** tap ✓ on any prayer request to mark it answered (with an optional update). Students can send **praise reports** (and share them on the Prayer Wall). Admins can mark Prayer Wall requests answered from the Inbox. Everything collects in the leader **Wall → Answered 🎉** view
- **"Someone prayed for you":** students can turn on notifications on the student page. They get one notification a day at most when someone taps 🙏 on their Prayer Wall request, or when a leader marks them prayed (after their first submission is approved)
- **Wall tab (leaders and staff):** one place to pray through what students and parents shared. **Students** shows the approved student Prayer Wall posts plus the Gospel conversation tracker; **Parents** shows the family requests parents chose to share with leaders (last 60 days). Leaders tap 🙏 on each, and the Pray tab shows a "New on the Wall" notice when something new comes in. Confidential parent requests never appear here; they stay in the admin Inbox
- **Check in this week (leader Pray tab):** a short list of students to reach out to: family requests and new prayer requests from the last 7 days, birthdays in the next 7 days, Gospel stories to celebrate, and anyone not prayed for in 2+ weeks. It uses the leader's small group if one is picked. "Checked in" is saved only on that phone and resets each Monday. Admins also see how many parents asked for a call
- **Event prayer focus (admin → Teach → Events):** add camp, retreats or mission trips with dates, an optional registration link (shows a Register button until the event starts), a prayer focus, prayer points and who's going (quick-add by HS, MS, small group or leaders). A countdown card appears up to 45 days before and during the event. Leaders can tap "Pray through the N going" to pray through the attendees. Students and parents see the card and how many are going, never the names
- **Monthly recap (admin → Report):** pick a month to see prayers, new requests (including from parents), answered prayers, Gospel conversations, friends who trusted Jesus, and the top stories. "Copy recap as text" lets you paste it into an email, text or staff notes. Request counts begin with this version, so earlier months show fewer
- **Calendar from BAND (admin → Teach → Calendar):** add each BAND calendar's link from Calendar → Manage Events → **Export Band Calendars** (IMPACT, dGroups and Events separately) and pick its color: IMPACT Blue, IMPACT Green or IMPACT Orange (gold for anything else). The Calendar tab shows the **next 2 weeks**, with a dropdown for the next month, 2 months or 4 months, and color chips to show or hide each calendar. Each event also names its calendar, so color isn't the only clue. Events update on their own about every 30 minutes (or tap **Refresh now**). A calendar can be set to "Leaders only." The links are stored on the server and only admins can see them. If an event's description includes a sign-up form link, a green **Register** button shows on that event
- **Staff and multiple groups:** mark any leader as Staff (badge and filter). Leaders can be MS & HS, and anyone can be in several small groups (for example a dGroup and an IMPACT group)
- **My small group:** each leader picks their small group once on the Pray tab; the deck opens to that group, with a one-tap switch to Everyone. Their group is highlighted in the Week tab
- **Streaks and goals:** a weekly team goal, a team streak, a personal daily streak, small group progress, and a Gospel-shared goal (Week tab; admins set goals in Report)
- **Daily reminders:** each leader can turn on a push notification at the time they choose (Week tab)
- **Security:** the app is locked behind sign-in, and passwords are stored only as scrambled hashes

### Who can see what

| Code | Who uses it | What they can do |
|---|---|---|
| **Admin password** | You, at `/admin` | Everything: People, Inbox, Report, Import, settings, photos |
| **Leader codes** (one per leader) | Leaders, at `/leaders` | Pray, Wall, Lessons, Devos, Calendar, Week, Roster. Leaders see names as first name + last initial, and a birthday only during that person's birthday month |
| **Parent code** | Parents, at `/parents` | The weekly lesson, the calendar, the student Prayer Wall (view and pray), and family prayer requests for approval. Parents can't see the roster |
| **Student code** | Students, at `/students` | Unlocks the Prayer Wall and Calendar on the student page. Sharing and the weekly lesson don't need a code. Students can't see the roster |

Sign-ins are remembered for 90 days (leaders), 24 hours (admin), 180 days (students) and 1 year (parents). Changing the student or parent code signs out everyone using the old one. Revoking a leader's code, or giving them a new one, signs out just that leader right away.

### One Church check-ins → Inbox

New students who check in to the **IMPACT** event in One Church show up at the top of the admin **Inbox** as "New from check-in" cards, with name, grade (from the Grade field on their One Church profile) and birthday (month and day only). On each card, pick their small groups and tap **Add to roster**, or link them to someone already on the roster, or tap **Not for the roster**. Each person is tracked by their One Church ID, so nobody is offered twice.

- **First-time import:** Inbox → One Church check-ins → **Settings → Import since Sep 1** (any start date in the last year). It finds everyone who checked in to IMPACT since then and adds anyone not on the roster to your Inbox in batches, with a progress bar. Each card shows their first visit and how many times they came. **Link all name matches** links everyone whose name exactly matches someone already on your roster in one tap. If the Inbox fills up (300 items), approve some and tap **Continue import**.
- **Every week after that:** the app checks One Church on its own, looking back 7 days, the first time a leader or admin opens the app (at most every 6 hours), plus whenever you open the Inbox or tap **Check One Church now**. People entered on Monday from paper cards still come through that week. Leaders' apps only start the check; names only ever show in your admin Inbox.
- New students show in leaders' **Check in this week** as "New at IMPACT! Reach out this week" for their first two weeks.
- Only name, grade and birthday are brought over. Phone numbers, emails and addresses stay in One Church.

**Setup (one time):**
1. In One Church: gear icon → **API / Webhooks** → **+ Add New**, name it "Let's Pray", choose **Custom** access with read-only permissions for People, Groups and Events. Copy the key (it's shown once).
2. In Cloudflare: your Let's Pray Pages project → **Settings → Variables and Secrets** → add a **secret** named `ONE_CHURCH_API_KEY` with that key. Redeploy (or upload the next update) so it takes effect.
3. In the app: Inbox → One Church check-ins → **Settings → Test connection**. It confirms the key works and finds the "IMPACT" event; the church address `livinghopefindlay.onechurchsoftware.com` is already set. The test also lists the field names One Church sent back (no personal data) in case anything needs adjusting.

Never put the key in GitHub, a chat or an email. If it's ever exposed, delete it in One Church and make a new one.

### Leader codes, names and the activity log (admin → Access)

- **Add a leader** by first and last name and the app makes a unique 10-character code (like `K7M4Q-9TPXR`). It's shown once so you can copy it or text it to them. Only a scrambled (hashed) version is stored, so nobody, including you, can look it up later; if a leader loses theirs, tap **New code**.
- **Revoke** stops a code and signs that leader out immediately. Revoked leaders can get a new code or be removed.
- The header shows who is signed in ("Signed in as Rachel S." or "Admin").
- **Names:** everywhere outside the admin screens (Pray cards, the Week tab's prayed-for list, Roster, Wall, check-ins) people show as first name + last initial. Full names are stored and appear only on admin screens (People, Inbox, Access). The server never sends full names or other months' birthdays to leaders, and saves from leaders can't overwrite the stored full name or birthday.
- **Birthdays** aren't listed on the Roster. A birthday shows only during that person's birthday month, as a reminder to pray for them.
- **Activity log:** every sign-in (including wrong codes) and every time a leader opens the Roster, with the time, role, leader name, IP address and browser. Only admins can see it. Entries delete themselves after 90 days.
- Too many wrong codes from one network (25 in an hour) pauses sign-in for that network for an hour.

### After this version deploys (one time)

1. Open the app and sign in with your **existing admin password**. It's upgraded to the secure format automatically.
2. Go to **Access** and add each leader to give them their own code. The old shared team code no longer works.
3. Optional: set a **student code** in the same place, and share `your-app-url/students` with students.

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
