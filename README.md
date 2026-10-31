# The Gospel Banker

A community app for the Seventh-day Adventist family: WhatsApp-style chat, a Facebook-style feed, LinkedIn-style profiles, and a curated library of Adventist content. It is an installable web app (PWA), so it works on Android, iPhone and desktop from one link, and can be added to the home screen like a native app.

## What's in this version

**Chat**
- One-to-one and group chats, delivered in real time
- Typing indicator, online status, unread badges, browser notifications

**Feed**
- Posts, prayer requests and testimonies
- "Amen" / "Praying" reactions and comments
- Verse of the day

**Profiles**
- Name, headline (profession or ministry), home church and bio
- Message anyone straight from their profile or post

**Videos (YouTube-style, hosted in the app)**
- Anyone can upload a video from their phone or computer, with an upload progress bar
- The thumbnail is captured automatically from the video, or you can pick your own image
- 15 categories: Music Videos, Choirs & Quartets, Sermons, Bible Study, Prophecy, Health Talks, Healthy Cooking, Mission Stories, Testimonies, Children, Youth & Pathfinders, Family & Marriage, Documentaries, Video Podcasts, Camp Meetings & Events
- The home page has shelves per category, plus Popular, Subscriptions and search
- The watch page has a player, views, "Amen" likes, comments, share, and more videos from the same category
- Every member has a channel that others can subscribe to
- Members' uploads wait for moderator approval before they go public; admins and moderators publish directly
- Videos are stored in `data/media` (set `MEDIA_DIR` to change it). The default size limit is 500 MB per video (`MAX_VIDEO_MB`).

**Library (16 sections)**
- Music Videos, Music, Sermons, Health Talks, Podcasts
- SDA Jobs, News, EGW Writings (with a search box), Articles, Bible Study Guides
- Stores, Mission Stories, Testimonies, Devotionals, Events, Volunteer & ADRA
- YouTube links play inside the app
- Jobs and events show location, type and deadline

**Keeping it clean**
- Every message, post, comment, profile and submission is filtered for abusive language
- Mild profanity and insults are masked (`s*****`); threats and harassment are blocked
- Three blocked messages mute the sender for an hour
- Set `ANTHROPIC_API_KEY` to add an AI check (Claude) that catches insults, harassment, hate and scams the word list misses. It allows Bible language such as "hell" used in a theological sense.
- Add local-language words (Swahili, Ekegusii…) to `moderation-words.txt`
- Members *suggest* library content and a moderator approves it, which keeps music and videos "pure Adventist"
- The Moderate tab (admins and moderators) has the approval queue and a log of filtered messages

## Run it

You need Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env    # then edit the values
npm start               # http://localhost:3000
```

Demo accounts created on first run:

| Username | Password | Role |
|---|---|---|
| `admin` | value of `ADMIN_PASSWORD` (default `changeme123`) | admin |
| `grace` | `password123` | member |
| `daniel` | `password123` | member |

Change the admin password and remove the demo members before going live. To make someone a moderator, call `POST /api/admin/users/:id/role` with `{"role":"moderator"}` as admin.

Run the tests with `npm test`.

## Deploy

**Render (easiest):** in Render choose New → Blueprint and pick this repository. `render.yaml` sets everything up, including a 10 GB disk for the database and videos. You'll be asked for `ADMIN_PASSWORD` and, optionally, `ANTHROPIC_API_KEY`. The disk needs Render's Starter plan (about $7/month plus disk).

**Oracle Cloud (free):** follow [deploy/ORACLE.md](deploy/ORACLE.md). A one-command installer sets up the app, HTTPS and the firewall.

Otherwise: it's a single Node.js server with an SQLite database file, so any host with a persistent disk works: Render, Railway or Fly.io (attach a volume), or a small VPS. A `Dockerfile` is included and stores the database in `/data`. Set `JWT_SECRET` and `ADMIN_PASSWORD`, and set `ANTHROPIC_API_KEY` if you want the AI filter. HTTPS is required for "Install app" and notifications, and these hosts provide it.

## How it's built

- `server/index.js`: Express REST API plus Socket.IO for real-time chat
- `server/db.js`: SQLite schema (built into Node), seeding
- `server/seed.js`: library sections and starter content
- `server/moderation.js`: the two-layer language filter
- `public/`: the app itself (plain JavaScript, no build step), service worker and manifest

## Next steps worth considering

- Video transcoding with ffmpeg (several qualities, and converting iPhone HEVC/MOV files so they play on every phone), and moving video files to cloud storage plus a CDN once there are many viewers
- Playlists, "watch later", and live streaming for Sabbath services

- Photo, voice-note and video messages (needs file storage such as S3 or Cloudinary)
- Push notifications when the app is closed (Web Push)
- Phone-number or email sign-up with verification, password reset
- Wrapping the PWA for the Play Store and App Store (e.g. with Capacitor)
- Sabbath sunset times, a church directory, and giving/tithe links
- Moving to Postgres once the community grows past a few thousand active users
