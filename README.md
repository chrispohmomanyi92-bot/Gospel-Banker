# The Gospel Banker

A community app for the Seventh-day Adventist family: WhatsApp-style chat, a Facebook-style feed, LinkedIn-style profiles, and a curated library of Adventist content. It is an installable web app (PWA), so it works on Android, iPhone and desktop from one link, and can be added to the home screen like a native app.

## What's in this version

**Chat**
- One-to-one and group chats, delivered in real time
- Typing indicator, online status, unread badges, browser notifications

**Home**
- Greeting with a Sabbath countdown and the verse of the day (with a Share button)
- Quick actions: ask for prayer, share a testimony, upload a video, message someone
- "Everything in one place": one tap to Videos, Downloads, Chats and all 16 library sections
- Previews of recent chats, new videos, sermons, jobs, EGW writings, events, devotionals and more
- The community feed (posts, prayer requests and testimonies) underneath

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
- **Download for offline:** tap ⬇️ Download on any video to keep a copy on the device. Videos › Downloads plays them without internet, and "Save file" puts a copy in the phone's files
- Members' uploads wait for moderator approval before they go public; admins and moderators publish directly
- Videos are stored in `data/media` (set `MEDIA_DIR` to change it). The default size limit is 500 MB per video (`MAX_VIDEO_MB`).

**Channels: videos, audio and files**
- Members upload videos, audio (MP3, M4A, WAV…) and files (PDF, Word, PowerPoint, EPUB, pictures) to their own channel
- Each upload can name a preacher, author or artist; the upload form suggests names already used so they stay consistent
- Browse by topic, by preacher/author (Videos › Preachers & authors), or by channel (Videos › Channels), and filter by Videos / Audio / Files
- Members pick their country from a dropdown, and the Channels page can be filtered by country
- Members can give their channel its own name and description (e.g. "Grace Health Corner"), separate from their personal name
- Audio plays in the app and can be downloaded for offline listening; files open (PDF, pictures) or download
- Viewers subscribe, say "Amen" (like) and comment on every public upload

**Member stores**
- Any member can open a store (up to 3), with a logo, description, country (chosen from a dropdown and used as a filter on the Stores page), town and how to buy (phone, WhatsApp, M-Pesa till)
- Stores are grouped into 12 categories: Books & Bibles, Health Foods, Bakery & Vegetarian Meals, Farm Produce, Natural Remedies, Modest Clothing, Music & Media, Crafts & Gifts, Pathfinder & Children, Education & Tutoring, Services, Other
- Owners list products with a photo, price and description; shoppers tap "Ask / order" to message the seller
- Every store has its own group chat to promote products. Shoppers join it from the store page, and new products can be announced there automatically
- New stores wait for moderator approval (the Moderate tab), like uploads do. Store pictures are stored in `data/media/stores`

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
