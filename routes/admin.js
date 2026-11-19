const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// Uploads: posters / banners. In production store in S3 / Cloud Storage
// and save the public URL — do not serve uploads from the API server.
// TODO: swap disk storage for object storage.
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^image\//.test(file.mimetype)),
});

// --- Analytics ---------------------------------------------------------
router.get('/stats', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const [users, premium, movies, series] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM users'),
      pool.query("SELECT COUNT(*)::int AS n FROM users WHERE is_premium = true"),
      pool.query('SELECT COUNT(*)::int AS n FROM movies'),
      pool.query('SELECT COUNT(*)::int AS n FROM series'),
    ]);
    const popular = await pool.query(
      'SELECT id, title, views FROM movies ORDER BY views DESC LIMIT 10',
    );
    res.json({
      data: {
        total_users: users.rows[0].n,
        active_premium_users: premium.rows[0].n,
        total_movies: movies.rows[0].n,
        total_series: series.rows[0].n,
        popular_content: popular.rows,
      },
    });
  } catch (e) { next(e); }
});

// --- Movies CRUD (content changes appear in the app immediately) --------
router.post('/movies', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const m = req.body || {};
    // Only accept fields the admin supplies; stream_url must be an
    // authorised HLS/DASH URL — never a pirated source.
    const { rows } = await pool.query(
      `INSERT INTO movies (title, overview, release_year, imdb_rating,
        duration_minutes, language, poster_url, backdrop_url, trailer_url,
        stream_url, genres, "cast", is_featured, is_premium, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        m.title, m.overview, m.release_year, m.imdb_rating,
        m.duration_minutes, m.language, m.poster_url, m.backdrop_url,
        m.trailer_url, m.stream_url, m.genres || [], m.cast || [],
        !!m.is_featured, !!m.is_premium, m.is_published !== false,
      ],
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { next(e); }
});

router.put('/movies/:id', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const m = req.body || {};
    const { rows } = await pool.query(
      `UPDATE movies SET title=$2, overview=$3, release_year=$4,
        imdb_rating=$5, duration_minutes=$6, language=$7, poster_url=$8,
        backdrop_url=$9, trailer_url=$10, stream_url=$11, genres=$12,
        "cast"=$13, is_featured=$14, is_premium=$15, is_published=$16,
        updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [
        req.params.id, m.title, m.overview, m.release_year, m.imdb_rating,
        m.duration_minutes, m.language, m.poster_url, m.backdrop_url,
        m.trailer_url, m.stream_url, m.genres || [], m.cast || [],
        !!m.is_featured, !!m.is_premium, m.is_published !== false,
      ],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Movie not found' });
    res.json({ data: rows[0] });
  } catch (e) { next(e); }
});

router.delete('/movies/:id', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM movies WHERE id=$1', [req.params.id]);
    res.json({ message: 'Movie deleted' });
  } catch (e) { next(e); }
});

// --- Poster / banner upload -------------------------------------------
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
  // TODO: upload to object storage and return its public URL.
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// --- Users / subscriptions management ----------------------------------
router.get('/users', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT id, name, email, is_premium, premium_plan, premium_expires_at, created_at FROM users ORDER BY created_at DESC LIMIT 100',
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.get('/subscriptions', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 100',
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// --- Genres -------------------------------------------------------------
router.get('/genres', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM genres ORDER BY name');
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.post('/genres', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'INSERT INTO genres (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [req.body.name],
    );
    res.status(201).json({ data: rows[0] || null });
  } catch (e) { next(e); }
});

// --- Content Engine: sources -------------------------------------------
// title_sources rows are the admin's view of "where can this title be
// watched". Playable streams (is_playable=true) are only ever allowed for
// source_type='public_domain' — provider/trailer rows are link-outs and
// can never be marked playable, no matter what the client sends.
const SOURCE_TYPES = ['trailer', 'provider', 'public_domain'];
const SOURCE_STATUSES = ['ok', 'broken', 'unchecked'];

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//.test(u);
}

// A playable public-domain source must be a direct media file, not a web
// page (e.g. not a YouTube watch link). Query strings are ignored.
function isDirectMediaUrl(u) {
  return isHttpUrl(u) && /\.(mp4|m3u8|mpd|mov|webm)(\?|#|$)/i.test(u);
}

function sourceTitleJoins() {
  return `LEFT JOIN movies m ON m.id = s.movie_id
          LEFT JOIN series se ON se.id = s.series_id`;
}

function sourceSelect() {
  return `SELECT s.*, m.title AS movie_title, se.title AS series_title
          FROM title_sources s ${sourceTitleJoins()}`;
}

// GET /api/admin/sources?status=&source_type=&provider=&q=&limit=&offset=
router.get('/sources', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const where = [];
    const params = [];
    if (req.query.status) {
      if (!SOURCE_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      params.push(req.query.status); where.push(`s.status = $${params.length}`);
    }
    if (req.query.source_type) {
      if (!SOURCE_TYPES.includes(req.query.source_type)) {
        return res.status(400).json({ message: 'Invalid source_type' });
      }
      params.push(req.query.source_type); where.push(`s.source_type = $${params.length}`);
    }
    if (req.query.provider) {
      params.push(`%${req.query.provider}%`); where.push(`s.provider_name ILIKE $${params.length}`);
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where.push(`(m.title ILIKE $${params.length} OR se.title ILIKE $${params.length})`);
    }
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    params.push(limit, offset);
    const { rows } = await pool.query(
      `${sourceSelect()} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY s.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// GET /api/admin/sources/broken — the monitoring view for the admin panel.
router.get('/sources/broken', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `${sourceSelect()} WHERE s.status = 'broken' ORDER BY s.updated_at DESC LIMIT 200`,
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// POST /api/admin/sources — attach a source to exactly one title.
router.post('/sources', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const s = req.body || {};
    if (!SOURCE_TYPES.includes(s.source_type)) {
      return res.status(400).json({ message: 'Invalid source_type' });
    }
    if ((s.movie_id == null) === (s.series_id == null)) {
      return res.status(400).json({ message: 'Exactly one of movie_id / series_id is required' });
    }
    if (!isHttpUrl(s.url)) {
      return res.status(400).json({ message: 'url must start with http:// or https://' });
    }
    if (s.status && !SOURCE_STATUSES.includes(s.status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    // Only public-domain rows may ever be playable, and only with a direct
    // media URL (a YouTube watch link must never become a "playable" stream).
    const isPlayable = s.source_type === 'public_domain' && !!s.is_playable;
    if (isPlayable && !isDirectMediaUrl(s.url)) {
      return res.status(400).json({ message: 'Playable public-domain sources need a direct media URL (.mp4 / .m3u8 / .mpd)' });
    }
    const { rows } = await pool.query(
      `INSERT INTO title_sources (movie_id, series_id, source_type, provider_name,
         provider_id, provider_logo_path, offer_type, url, language, quality,
         region, is_playable, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [s.movie_id || null, s.series_id || null, s.source_type, s.provider_name || null,
       s.provider_id || null, s.provider_logo_path || null, s.offer_type || null,
       s.url, s.language || null, s.quality || null, s.region || null,
       isPlayable, s.status || 'unchecked'],
    );
    res.status(201).json({ data: rows[0] });
  } catch (e) { next(e); }
});

// PUT /api/admin/sources/:id — fix a broken link, rename a provider, etc.
router.put('/sources/:id', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const s = req.body || {};
    if (s.url && !isHttpUrl(s.url)) {
      return res.status(400).json({ message: 'url must start with http:// or https://' });
    }
    if (s.status && !SOURCE_STATUSES.includes(s.status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    if (s.source_type && !SOURCE_TYPES.includes(s.source_type)) {
      return res.status(400).json({ message: 'Invalid source_type' });
    }
    // Validate the *resulting* row: a public_domain row that stays/would
    // become playable needs a direct media URL (never a YouTube page link).
    const existing = await pool.query(
      'SELECT source_type, url, is_playable FROM title_sources WHERE id = $1',
      [req.params.id],
    );
    if (!existing.rows[0]) return res.status(404).json({ message: 'Source not found' });
    const effType = s.source_type || existing.rows[0].source_type;
    const effUrl = s.url || existing.rows[0].url;
    const effPlayable = s.is_playable == null
      ? existing.rows[0].is_playable : !!s.is_playable;
    if (effType === 'public_domain' && effPlayable && !isDirectMediaUrl(effUrl)) {
      return res.status(400).json({ message: 'Playable public-domain sources need a direct media URL (.mp4 / .m3u8 / .mpd)' });
    }
    const { rows } = await pool.query(
      `UPDATE title_sources SET
         url = COALESCE($2, url),
         provider_name = COALESCE($3, provider_name),
         provider_id = COALESCE($4, provider_id),
         provider_logo_path = COALESCE($5, provider_logo_path),
         offer_type = COALESCE($6, offer_type),
         language = COALESCE($7, language),
         quality = COALESCE($8, quality),
         region = COALESCE($9, region),
         status = COALESCE($10, status),
         -- a row can only be playable if it is (or stays) public_domain
         is_playable = CASE WHEN COALESCE($11, source_type) = 'public_domain'
                            THEN COALESCE($12, is_playable) ELSE FALSE END,
         source_type = COALESCE($11, source_type),
         last_checked_at = CASE WHEN $10 IS NOT NULL THEN NOW() ELSE last_checked_at END,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, s.url || null, s.provider_name || null, s.provider_id || null,
       s.provider_logo_path || null, s.offer_type || null, s.language || null,
       s.quality || null, s.region || null, s.status || null,
       s.source_type || null, s.is_playable == null ? null : !!s.is_playable],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Source not found' });
    res.json({ data: rows[0] });
  } catch (e) { next(e); }
});

router.delete('/sources/:id', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM title_sources WHERE id = $1', [req.params.id]);
    res.json({ message: 'Source deleted' });
  } catch (e) { next(e); }
});

// GET /api/admin/providers — distinct providers in use, with broken counts.
router.get('/providers', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT provider_name, source_type,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'broken')::int AS broken,
              COUNT(*) FILTER (WHERE status = 'unchecked')::int AS unchecked
       FROM title_sources WHERE provider_name IS NOT NULL
       GROUP BY provider_name, source_type ORDER BY total DESC`,
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// --- Content Engine: sync state ----------------------------------------
// GET /api/admin/sync-state — what the last daily sync did.
router.get('/sync-state', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM sync_state WHERE id = 1');
    res.json({ data: rows[0] || {
      id: 1, last_sync_at: null, movies_upserted: 0, series_upserted: 0,
      providers_stored: 0, trailers_stored: 0, categories_assigned: 0,
      last_error: 'sync has never run',
    } });
  } catch (e) { next(e); }
});

// POST /api/admin/sync/trigger — the sync is a separate scheduled job
// (it needs the TMDB key and the DB tunnel, neither of which lives in the
// API process). This endpoint reports that fact plus the exact command.
router.post('/sync/trigger', async (req, res, next) => {
  try {
    res.json({ data: {
      message: 'The catalog sync runs as a separate scheduled job, not inside the API. Run the command below (or wait for the daily cron).',
      command: 'cd ~/workspace/netfly/engine && TMDB_API_KEY=$TMDB_API_KEY DATABASE_URL=$DATABASE_URL ./run_daily_sync.sh',
      key_configured_in_api_process: !!process.env.TMDB_API_KEY,
      docs: 'engine/README.md',
    } });
  } catch (e) { next(e); }
});

// --- Content Engine: categories ----------------------------------------
// GET /api/admin/categories — all categories (active and inactive).
router.get('/categories', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY sort_order, name');
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const c = req.body || {};
    if (!/^[a-z0-9-]+$/.test(c.slug || '')) {
      return res.status(400).json({ message: 'slug must be lowercase letters, digits and hyphens' });
    }
    if (!c.name) return res.status(400).json({ message: 'name is required' });
    if (c.kind && !['region', 'genre', 'custom'].includes(c.kind)) {
      return res.status(400).json({ message: 'Invalid kind' });
    }
    const { rows } = await pool.query(
      `INSERT INTO categories (slug, name, kind, tmdb_language, tmdb_region,
         tmdb_genre_id, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO NOTHING RETURNING *`,
      [c.slug, c.name, c.kind || 'custom', c.tmdb_language || null,
       c.tmdb_region || null, c.tmdb_genre_id || null,
       c.is_active !== false, c.sort_order || 0],
    );
    if (!rows[0]) return res.status(409).json({ message: 'Category slug already exists' });
    res.status(201).json({ data: rows[0] });
  } catch (e) { next(e); }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const c = req.body || {};
    if (c.kind && !['region', 'genre', 'custom'].includes(c.kind)) {
      return res.status(400).json({ message: 'Invalid kind' });
    }
    const { rows } = await pool.query(
      `UPDATE categories SET
         name = COALESCE($2, name),
         kind = COALESCE($3, kind),
         tmdb_language = COALESCE($4, tmdb_language),
         tmdb_region = COALESCE($5, tmdb_region),
         tmdb_genre_id = COALESCE($6, tmdb_genre_id),
         is_active = COALESCE($7, is_active),
         sort_order = COALESCE($8, sort_order)
       WHERE id = $1 RETURNING *`,
      [req.params.id, c.name || null, c.kind || null, c.tmdb_language || null,
       c.tmdb_region || null, c.tmdb_genre_id || null,
       c.is_active == null ? null : !!c.is_active, c.sort_order || null],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Category not found' });
    res.json({ data: rows[0] });
  } catch (e) { next(e); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ message: 'Category deleted' });
  } catch (e) { next(e); }
});

// Title <-> category assignment (used by the admin panel's featured /
// category management; the sync assigns categories itself).
router.get('/movies/:id/categories', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT c.* FROM categories c
       JOIN movie_categories mc ON mc.category_id = c.id
       WHERE mc.movie_id = $1 ORDER BY c.sort_order, c.name`,
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.post('/movies/:id/categories', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    if (!req.body.category_id) return res.status(400).json({ message: 'category_id is required' });
    await pool.query(
      `INSERT INTO movie_categories (movie_id, category_id) VALUES ($1, $2)
       ON CONFLICT (movie_id, category_id) DO NOTHING`,
      [req.params.id, req.body.category_id],
    );
    res.status(201).json({ message: 'Category assigned' });
  } catch (e) { next(e); }
});

router.delete('/movies/:id/categories/:categoryId', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'DELETE FROM movie_categories WHERE movie_id = $1 AND category_id = $2',
      [req.params.id, req.params.categoryId],
    );
    res.json({ message: 'Category removed' });
  } catch (e) { next(e); }
});

router.get('/series/:id/categories', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT c.* FROM categories c
       JOIN series_categories sc ON sc.category_id = c.id
       WHERE sc.series_id = $1 ORDER BY c.sort_order, c.name`,
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

router.post('/series/:id/categories', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    if (!req.body.category_id) return res.status(400).json({ message: 'category_id is required' });
    await pool.query(
      `INSERT INTO series_categories (series_id, category_id) VALUES ($1, $2)
       ON CONFLICT (series_id, category_id) DO NOTHING`,
      [req.params.id, req.body.category_id],
    );
    res.status(201).json({ message: 'Category assigned' });
  } catch (e) { next(e); }
});

router.delete('/series/:id/categories/:categoryId', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'DELETE FROM series_categories WHERE series_id = $1 AND category_id = $2',
      [req.params.id, req.params.categoryId],
    );
    res.json({ message: 'Category removed' });
  } catch (e) { next(e); }
});

// --- Content Engine: featured management -------------------------------
// POST /api/admin/movies/:id/featured { "is_featured": true }
router.post('/movies/:id/featured', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'UPDATE movies SET is_featured = $2, updated_at = NOW() WHERE id = $1 RETURNING id, title, is_featured',
      [req.params.id, !!req.body.is_featured],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Movie not found' });
    res.json({ data: rows[0] });
  } catch (e) { next(e); }
});

router.post('/series/:id/featured', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'UPDATE series SET is_featured = $2, updated_at = NOW() WHERE id = $1 RETURNING id, title, is_featured',
      [req.params.id, !!req.body.is_featured],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Series not found' });
    res.json({ data: rows[0] });
  } catch (e) { next(e); }
});

// TODO: series / seasons / episodes CRUD mirrors the movie endpoints
// above (POST/PUT/DELETE /api/admin/series, /seasons, /episodes),
// plus ads_config management (GET/PUT /api/admin/ads).

module.exports = router;
