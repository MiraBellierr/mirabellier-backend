# Mirabellier.com

![](https://i.pinimg.com/736x/b5/23/39/b523395fe0601e970ff89626c0f76aa8.jpg)

This is the backend for my little corner of the web.

It is a cozy-but-serious Express app that handles auth, data, uploads, share previews, and all the behind-the-scenes logic that keeps the frontend feeling smooth.

## Hiya!!

The frontend gets the sparkles, but this is the quiet engine room. It stores the content, protects auth sessions, syncs live-ish data, and makes sure the cute pages are backed by real behavior.

## What this backend does

- Serves blog posts, tags, comments, and likes
- Handles Discord OAuth login and httpOnly session cookies
- Stores and updates public profile data
- Powers the guestbook board with synced note positions
- Runs the Arena API (profile, collection, shop, fight, leaderboard)
- Runs Question of the Day APIs (current, answers, archive, admin queue)
- Serves shrine admin/content APIs and shrine SEO/share pages
- Serves anime and quote SEO/share pages + embed images
- Stores quote snapshots and MyAnimeList currently-watching snapshots
- Handles image uploads and optimization
- Generates sitemap data and supports IndexNow submission

## Tiny project tour

```text
mirabellier-backend/
|- app.js            Main server entry + middleware setup
|- routes/           Feature route modules (posts, auth, arena, qotd, etc.)
|- lib/              DB, auth/session, embeds, sitemap, integrations
|- scripts/          Utility scripts
|- test/             Node test files
|- images/           Uploaded images
|- data/             Runtime/generated backend data files
|- database.sqlite3  Local SQLite database
`- package.json      Backend scripts and deps
```

## The stack

- Node.js
- Express 5
- SQLite with `better-sqlite3`
- Passport Discord
- Multer
- Sharp

## API base notes

Frontend usually calls this API at `/v1` (example: `http://localhost:3000/v1`).

This backend also accepts unprefixed routes because it normalizes `/v1/*` internally. So these are equivalent:

- `/v1/posts`
- `/posts`

## Running it locally

### 1. Install dependencies

```bash
cd mirabellier-backend
npm install
```

### 2. Create `mirabellier-backend/.env`

Copy `.env.example` and fill in your values.

```env
PORT=3000
DB_FILE=./database.sqlite3
SESSION_SECRET=your-very-secret-value
OWNER_DISCORD_IDS=your_discord_user_id
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=http://localhost:3000/auth/discord/callback
FRONTEND_URL=http://localhost:5173
MAL_CLIENT_ID=your_myanimelist_client_id
MAL_USERNAME=your_myanimelist_username
WEBSITE_BASE=https://mirabellier.com
INDEXNOW_KEY=your-indexnow-key
```

Useful optional vars are documented in `.env.example` (session cookie options, QOTD webhook options, MAL refresh interval, quote schedule, and IndexNow toggles).

### Arena character catalog

Arena card draws use the favorites-ranked local file at
`data/mal-characters.json`. Refresh it by scraping MyAnimeList:

```bash
cd mirabellier-backend
npm run scrape:mal:characters
```

The scraper checkpoints every 50 characters and resumes automatically. You can
override the catalog path if needed:

```env
MAL_CHARACTERS_FILE=./data/mal-characters.json
```

Card rarity follows the character's position in that ranked file: top 1% UR,
next 4% SSR, next 10% SR, next 25% R, and the remaining 60% C.

### 3. Start the server

For development:

```bash
npm run dev
```

For a regular run:

```bash
npm start
```

With `PORT=3000`, the backend runs at `http://localhost:3000`.  
If `PORT` is missing, `app.js` falls back to `5000`.

## Useful scripts

- `npm run dev` - run backend with nodemon
- `npm start` - run backend normally
- `npm run generate:sitemap` - regenerate sitemap data
- `npm run scrape:mal:characters` - refresh the ranked local Arena character catalog
- `npm run migrate:card-rarities` - preview rank-based rarity updates for stored cards
- `npm test` - run Node tests

## Main route map

### Posts and blog

- `GET /posts` - list posts
- `GET /posts/:id` - fetch one post
- `POST /posts` - create post
- `PUT /posts/:id` - update post
- `DELETE /posts/:id` - delete post
- `POST /posts/:id/comments` - add comment
- `POST /posts/:id/like` - like/unlike post
- `GET /tags` - list unique blog tags
- `GET /blog/:id` - SEO/share page for single blog route

### Auth and profile

- `GET /auth/discord` - start Discord OAuth
- `GET /auth/discord/callback` - finish Discord OAuth
- `GET /me` - current authenticated user
- `POST /me` - update profile (+ avatar/banner upload)
- `POST /logout` - destroy session
- `GET /user/:id` - public user profile by id
- `GET /user/by-username/:username` - public user profile by username
- `GET /user/:id/stats` - public user stats
- `GET /profile/:username` - SEO/share page for public profile route
- `GET /profile-embed/:username.png` - profile share image
- `GET /api/profile-embed/:username.png` - alias profile share image route

### Guestbook

- `GET /guestbook` - list notes
- `POST /guestbook` - create note
- `PATCH /guestbook/:id/position` - save note position
- `DELETE /guestbook/:id` - delete note (owner only)

### Arena

- `GET /arena/profile` - arena profile payload
- `GET /arena/collection` - owned cards payload
- `POST /arena/collection/select-card` - choose active card
- `GET /arena/updates` - newest Arena home update posts
- `POST /arena/updates` - publish an Arena update (owner only)
- `DELETE /arena/updates/:updateId` - delete an Arena update (owner only)
- `POST /arena/fight` - run fight
- `POST /arena/draw-card` - daily draw
- `GET /arena/shop` - shop payload
- `POST /arena/shop/buy` - buy shop item
- `POST /arena/shop/use-consumable` - use consumable
- `POST /arena/shop/craft` - craft recipe
- `GET /arena/leaderboard` - leaderboard data

### Question of the Day

- `GET /question-of-the-day` - SEO/share page
- `GET /question-of-the-day/embed-image.png` - QOTD share image
- `GET /question-of-the-day/current` - current question + answers
- `POST /question-of-the-day/current` - set/update current question (owner)
- `POST /question-of-the-day/current/answers` - submit answer
- `GET /question-of-the-day/admin/questions` - admin queue page
- `POST /question-of-the-day/admin/questions` - queue prompts (owner)
- `POST /question-of-the-day/admin/current/force-archive` - force archive (owner)
- `GET /question-of-the-day/archive` - archive list
- `GET /question-of-the-day/archive/:recordedDate` - archive day detail
- `DELETE /question-of-the-day/answers/:id` - delete answer (owner)

### Anime, quotes, shrines, images

- `GET /anime` - SEO/share page
- `GET /anime/currently-watching` - MAL-backed currently watching feed
- `GET /anime/currently-watching/embed-image.png` - anime share image
- `GET /quotes` - SEO/share page
- `GET /quotes/embed-image.png` - quotes share image
- `GET /quote-of-the-day` - quote snapshot payload
- `GET /shrines/pages` - list shrine page configs
- `GET /shrines/pages/:slug` - get shrine page config
- `POST /shrines/pages` - create shrine page config (owner)
- `PUT /shrines/pages/:slug` - update shrine page config (owner)
- `GET /shrine` - shrine hub SEO/share page
- `GET /shrine/:slug` - shrine entry SEO/share page
- `POST /posts-img` - upload image for posts
- `GET /images/list` - list uploaded image files
- `GET /images/meta/:filename` - read image metadata
- `GET /images/:filename` - static image file serving

## If something feels broken

- Check `mirabellier-backend/.env` first
- If login fails, verify Discord app credentials + callback URL
- If frontend auth redirects look wrong, verify `FRONTEND_URL`
- If uploads fail, verify `IMAGES_DIR` path and file permissions
- If MAL endpoints fail, verify `MAL_CLIENT_ID` and `MAL_USERNAME`
- If data seems stale, make sure only one local process is writing the same SQLite DB
- If owner-only routes return 403, verify `OWNER_DISCORD_IDS`

## Why this repo exists

I wanted the backend to stay understandable while still doing real app work.
Soft attitude, practical behavior, and sturdy enough to keep adding new little features without turning into spaghetti.
