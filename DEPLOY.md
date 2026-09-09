# Deployment

CI/CD lives in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

- **On every push and PR to `main`:** `npm ci` + `npm test` (the `test` job).
- **On a push to `main`, once tests pass:** the `deploy` job ships an atomic
  release to the VPS and reloads pm2.

## Release layout on the VPS

```
/srv/mirabellier.com/api/
├── releases/<commit-sha>/      full source; `npm ci --omit=dev` run here on the box
├── shared/                     persists across every release
│   ├── .env                    secrets — server-managed, REQUIRED, never touched by CI
│   ├── database.sqlite3        (+ -wal, -shm, and any *-backup* files)
│   ├── images/
│   ├── videos/
│   └── data/
│       ├── tiktok-cookies.txt
│       ├── instagram-cookies.txt
│       ├── youtube-cookies.txt
│       └── avatar-cache.json
├── logs/  → shared/logs/       pm2 stdout/stderr
└── current -> releases/<sha>   the symlink pm2 (and nginx's proxy_pass) target
```

Each deploy: upload source → `npm ci --omit=dev` → symlink `.env`,
`database.sqlite3`, `images/`, `videos/` and the four `data/*` runtime files in
from `shared/` → flip `current` with a single `rename(2)` → `pm2 startOrReload`
→ HTTP health check on `127.0.0.1:$PORT/`. A failed `npm ci`, a pm2 failure, or
a failed health check rolls `current` back to the previous release and reloads
it. The five most recent releases are kept.

`app.js` reads `.env` from `__dirname/.env` (i.e. `current/.env` → the symlink),
so the running directory does not matter.

## Required GitHub Actions secrets

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | VPS hostname / IP |
| `VPS_ROOT_USER` | SSH user with write access to `/srv/mirabellier.com` and permission to run `pm2` — i.e. `root` |
| `VPS_ROOT_SSH_KEY` | Private key (PEM) for that user |

## One-time server setup

Run once, as the deploy user:

```sh
# 1. Toolchain: Node (with npm on PATH for non-login shells), build tools for
#    better-sqlite3, and pm2.
#    node/npm/pm2 must resolve in a plain `ssh host 'pm2 -v'` — if you use nvm,
#    symlink them into /usr/local/bin.
apt-get install -y build-essential python3
npm i -g pm2

# 2. Directory skeleton.
mkdir -p /srv/mirabellier.com/api/releases \
         /srv/mirabellier.com/api/shared/data \
         /srv/mirabellier.com/api/shared/images \
         /srv/mirabellier.com/api/shared/videos \
         /srv/mirabellier.com/api/shared/logs

# 3. Secrets + existing data. Copy your current production files in:
cp /path/to/.env               /srv/mirabellier.com/api/shared/.env
cp /path/to/database.sqlite3*  /srv/mirabellier.com/api/shared/
cp -r /path/to/images/.        /srv/mirabellier.com/api/shared/images/
cp -r /path/to/videos/.        /srv/mirabellier.com/api/shared/videos/
cp /path/to/*-cookies.txt \
   /path/to/avatar-cache.json  /srv/mirabellier.com/api/shared/data/   # optional

# 4. pm2 on boot (once).
pm2 startup    # run the command it prints
```

There is no separate migration step — `lib/db.js` runs `CREATE TABLE IF NOT
EXISTS` / `ALTER TABLE` on boot, so the new release migrates the schema when it
starts. If `shared/database.sqlite3` does not exist, the first boot creates an
empty database and builds the full schema.

The first automated deploy replaces any pre-existing real `current/` directory
with the symlink. nginx must be allowed to follow it (`disable_symlinks off`,
the default) if it serves anything from `current/` directly.
