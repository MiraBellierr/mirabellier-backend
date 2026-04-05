# Mirabellier.com

![](https://i.pinimg.com/736x/b5/23/39/b523395fe0601e970ff89626c0f76aa8.jpg)

This is the backend for my little corner of the web.

It is a small Express app that handles the practical side of the site: blog posts, comments, likes, Discord login, profile updates, anime data, image uploads, quote snapshots, sitemap generation, and a few SEO-friendly routes for sharing pages nicely.

## Hiya!!

The frontend gets most of the cute attention, but this is the part quietly doing the real work in the background. It stores the data, serves the images, handles auth, keeps the blog editable, and makes sure the site still works like an actual app instead of just being a pretty page.

## What lives here

- Blog post CRUD routes
- Comment and like handling
- Guestbook entry, position, and moderation routes
- Discord OAuth login and session tokens
- Profile update routes
- Anime feed routes
- MyAnimeList currently-watching snapshot sync
- Daily quote snapshot storage and fetching
- Image upload and optimization
- Sitemap and IndexNow helpers

## Tiny project tour

```text
mirabellier-backend/
|- app.js            Main server entry
|- routes/           Route handlers for posts, auth, anime, guestbook, images, quotes
|- lib/              Database, uploads, users, sitemap, quote helpers
|- images/           Uploaded images
|- scripts/          Utility scripts
|- database.sqlite3  Local SQLite database
`- package.json      Backend scripts
```

## The stack

- Node.js
- Express 5
- SQLite with `better-sqlite3`
- Passport Discord
- Multer
- Sharp

## Running it locally

### 1. Install dependencies

```bash
cd mirabellier-backend
npm install
```

### 2. Create `mirabellier-backend/.env`

Use `.env.example` as your starting point.

```env
PORT=3000
DB_FILE=./database.sqlite3
SESSION_SECRET=your-very-secret-value
IMAGES_DIR=images
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=http://localhost:3000/auth/discord/callback
FRONTEND_URL=http://localhost:5173
MAL_CLIENT_ID=your_myanimelist_client_id
MAL_USERNAME=your_myanimelist_username
MAL_ANIME_REFRESH_MINUTES=5
WEBSITE_BASE=https://mirabellier.com
INDEXNOW_KEY=your-indexnow-key
QOTD_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### 3. Start the server

For development:

```bash
npm run dev
```

For a regular run:

```bash
npm start
```

With the example `.env` above, the backend will run at `http://localhost:3000`. If `PORT` is unset, `app.js` falls back to `5000`.

## Useful scripts

- `npm run dev` - start the backend with nodemon
- `npm start` - start the backend normally
- `npm run generate:sitemap` - regenerate sitemap data

## A few nice details

- The SQLite database is initialized automatically on startup
- Uploaded images get optimized with Sharp
- Quote data is stored as snapshots instead of being scraped every time
- The API supports anonymous likes as well as logged-in likes
- Guestbook note positions are stored in SQLite, so moving a note syncs for other visitors
- The owner account can moderate guestbook notes
- MyAnimeList currently-watching data is cached in SQLite so the public page can survive MAL outages
- The server generates SEO-friendly responses for shared blog and profile links
- Sitemap and IndexNow helpers are built in so new posts can be surfaced faster
- Question of the Day can post one Discord webhook notification per live drop

## MyAnimeList currently-watching feed

The public `/anime` page can sync directly from a public MyAnimeList profile.

Set these env vars in `mirabellier-backend/.env`:

- `MAL_CLIENT_ID` from your MyAnimeList API app
- `MAL_USERNAME` for the public profile you want to mirror
- optional `MAL_ANIME_REFRESH_MINUTES` to change the backend refresh window from the default 5 minutes

This v1 uses the public username endpoint with the `X-MAL-CLIENT-ID` header. It does not use MAL OAuth.

The backend stores the last successful normalized snapshot in SQLite, serves that snapshot while it is fresh, refreshes it when stale, and falls back to the last successful result with `stale: true` if MAL is temporarily unavailable.

## Question of the Day Discord webhook

If you want a Discord channel ping whenever a new Question of the Day goes live:

1. Open your Discord server channel settings.
2. Go to `Integrations > Webhooks`.
3. Create a webhook for the channel you want.
4. Copy the webhook URL into `mirabellier-backend/.env` as `QOTD_DISCORD_WEBHOOK_URL`.

Optional env vars:

- `QOTD_DISCORD_WEBHOOK_USERNAME` to change the webhook display name
- `QOTD_DISCORD_WEBHOOK_AVATAR_URL` to change the webhook avatar

The backend only posts once per question, stores that state in SQLite, checks again on startup, and keeps a lightweight background check running so UTC-day rollovers still notify even without an admin action.

## Main routes

- `GET /posts` - list blog posts
- `GET /posts/:id` - fetch one post
- `POST /posts` - create a post
- `PUT /posts/:id` - update a post
- `DELETE /posts/:id` - delete a post
- `POST /posts/:id/comments` - add a comment
- `POST /posts/:id/like` - like or unlike a post
- `GET /guestbook` - list guestbook notes
- `POST /guestbook` - create a guestbook note
- `PATCH /guestbook/:id/position` - save a note position on the board
- `DELETE /guestbook/:id` - delete a guestbook note as the owner account
- `POST /posts-img` - upload an image
- `GET /anime/currently-watching` - fetch the live MyAnimeList-backed currently watching feed
- `GET /quote-of-the-day` - fetch a daily quote snapshot
- `GET /auth/discord` - start Discord OAuth
- `GET /auth/discord/callback` - finish Discord OAuth
- `GET /me` - fetch the current user
- `POST /me` - update the current user profile
- `POST /logout` - destroy the current session
- `GET /user/:id` - fetch a public user profile by id
- `GET /user/by-username/:username` - fetch a public user profile by username
- `GET /user/:id/stats` - fetch public stats for a user

## If something feels broken

- Check your `.env` first
- If Discord login fails, the callback URL is usually the first thing to verify
- If uploads fail, make sure `IMAGES_DIR` is writable and Sharp installed correctly
- If data seems stale or locked, make sure only one local server is using the SQLite file
- If frontend auth redirects look wrong, check `FRONTEND_URL`
- If guestbook note positions look clipped, make sure the backend is running the current board-size constants

## Why this repo exists

I wanted the backend to stay small enough to understand, but capable enough to support the whole site properly. It is not trying to be fancy for the sake of it. It just needs to be dependable, readable, and easy to extend whenever I add another little feature to the site.

That is the whole mood of this backend: quiet, useful, and doing a lot more than it shows.
