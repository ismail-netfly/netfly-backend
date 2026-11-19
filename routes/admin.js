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

// TODO: series / seasons / episodes CRUD mirrors the movie endpoints
// above (POST/PUT/DELETE /api/admin/series, /seasons, /episodes),
// plus ads_config management (GET/PUT /api/admin/ads).

module.exports = router;
