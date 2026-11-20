# Netfly backend — deployment

Live API: `https://netfly-backend-akeh.onrender.com`
Repo: `https://github.com/ismail-netfly/netfly-backend` (branch `main`)
Render service: Node/Express, Singapore. **Auto-deploy is OFF** — every
push to GitHub needs a manual deploy in the Render dashboard (see below).
No agent can do the dashboard step; a human must click Deploy.

## 1. Deploy a new version (manual — Render dashboard)

1. Push the change to GitHub (`main`).
2. Open the Render dashboard → service `netfly-backend-akeh` → **Manual
   Deploy → Deploy latest commit** (or pick the commit).
3. Wait for the build (`npm install`) and for the service to report
   **Live**.
4. Verify: `curl https://netfly-backend-akeh.onrender.com/health`
   must return `{ "ok": true, "app": "netfly" }`, and
   `curl https://netfly-backend-akeh.onrender.com/api/movies?category=trending`
   must return HTTP 200 with data.
5. Spot-check the new endpoints (logged in as admin — see §5):
   `GET /api/titles/518/sources` returns the Big Buck Bunny stream.

If the deploy fails, check the Render build/runtime logs first; the
service keeps serving the previous build until the new one is live.

## 2. Required environment variables (Render → Environment)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Render Postgres `netfly-db` External Database URL. The pool connects with it directly. |
| `JWT_SECRET` | Secret used to sign/verify auth tokens. Must match the value the app was built against — changing it logs every user out. |
| `PORT` | Set by Render automatically (do not override). |
| `CORS_ORIGIN` | Allowed origin, `*` by default. |
| `NODE_ENV` | `production` (hides error details). |
| `TMDB_API_KEY` | Only needed if the API process itself ever calls TMDB. The daily sync does **not** run inside the API — it uses the key stored in the `netfly-daily-sync` cron body (see §3). Do not put the TMDB key in the repo. |

Never commit `.env` or any secret. The live values are in the Render
dashboard and (TMDB key + DATABASE_URL) in the `netfly-daily-sync` cron
body; both are the only copies.

## 3. Daily sync (cron — already set up, do not recreate)

- Cron job `netfly-daily-sync`, daily **04:07 PKT**, runs
  `~/workspace/netfly/engine/run_daily_sync.sh` with `TMDB_API_KEY` and
  `DATABASE_URL` from its own body.
- Pipeline: TMDB sync → apply SQL → provider discovery (archive.org,
  max 20 new playable titles/day) → `check_sources.py` (HEAD health
  check) → `streamcheck.py` (ffprobe validation — a source counts as
  playable only after this passes).
- The job reports only on failure, a sharp catalog drop, or an
  unreachable API. A successful routine sync needs no message.
- To run it now: trigger `netfly-daily-sync` from the scheduler
  (manual run) and check its logs + the DB rows afterwards.

## 4. Database migrations

- Versioned files: `backend/migrations/001_providers.sql`,
  `002_title_sources_multisource.sql`, `003_stream_validation.sql`.
  Each is idempotent (`IF NOT EXISTS` / `ON CONFLICT`).
- Apply on a fresh database with:
  `DATABASE_URL=postgresql://... node scripts/migrate.js`
  (records applied files in `schema_migrations`).
- The live database already has 001–003 applied (2026-11-20). Do not
  re-apply by hand — `migrate.js` will skip them.

## 5. Admin dashboard access

- In the app: **Profile → Admin Dashboard** (visible only to admin
  accounts). Admin account: `muhammadismail134700@gmail.com`
  (password in `~/workspace/netfly/ADMIN-NOTES.md`, chmod 600 — never
  share it). No new credentials are needed.
- The dashboard manages sources, providers, categories and featured
  titles through the `/api/admin/*` endpoints (see `API.md`).

## 6. Database backup — read this before 19 Dec 2026

**The free Render Postgres database `netfly-db` expires 19 Dec 2026.**
Before that date:

1. Take a full backup: from a host that can reach the DB,
   `pg_dump $DATABASE_URL > netfly-db-backup-YYYYMMDD.sql`
   (on the dev VM the DB is only reachable through the socat tunnel —
   use `engine/db.py` or run `pg_dump` from Render Shell).
2. Restore it to a new Postgres instance (paid Render plan, or any
   Postgres 15+ host) and point `DATABASE_URL` at the new instance.
3. If the database disappears before the backup, report it immediately
   — the catalog (movies/series/sources) lives only there.
4. Keep the keystore + `ADMIN-NOTES.md` safe separately; losing them
   blocks future APK updates and admin access.

## 7. Troubleshooting

- **New endpoints 404 on live but work locally**: the Render deploy is
  pending — deploy the latest commit (see §1). The live API only serves
  what was last deployed.
- **`/api/titles/:id/sources` returns `[]` for a known playable title**:
  check, in order: the source row is `public_domain` + `is_playable` +
  `enabled` + `status='ok'` + `stream_validated=true`, and its provider
  row is enabled (`GET /api/admin/sources/health` shows all of this).
- **Weekly submission-style stalls / 429s from TMDB or archive.org**:
  the sync throttles itself (TMDB ≤ 35 calls/10 s, 0.5 s between
  archive.org metadata calls). Wait for the next daily run; do not
  re-run the sync in a tight loop.
- **Login fails after a `JWT_SECRET` change**: all issued tokens are
  invalid; users must sign in again.
