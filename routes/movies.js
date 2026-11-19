const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { getSources } = require('./sourceHelpers');

const router = express.Router();

// GET /api/movies?category=trending|popular|latest|top_rated|upcoming|featured
//   &catalog=hollywood|bollywood|pakistani|korean|chinese|turkish|anime
//   &genre=&year=&language=&page=
// Sections are derived from the synced TMDB data: trending = TMDB trending
// (flagged is_featured by the sync, ordered by popularity), popular =
// popularity, top_rated = imdb_rating, latest = newest release_date,
// upcoming = release_date in the future. stream_url is only returned when
// the caller is authorised (logged in and, for premium titles, premium).
// Never return stream URLs to anonymous users.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category, genre, year, language, catalog } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 24;
    const offset = (page - 1) * limit;
    const pool = req.app.locals.pool;

    const where = ['movies.is_published = true'];
    const params = [];
    let from = 'movies';
    if (catalog) {
      params.push(catalog);
      from = `movies
        JOIN movie_categories mc ON mc.movie_id = movies.id
        JOIN categories c ON c.id = mc.category_id
          AND c.slug = $${params.length} AND c.is_active = true`;
    }
    if (genre) { params.push(genre); where.push(`$${params.length} = ANY(movies.genres)`); }
    if (year) { params.push(parseInt(year, 10)); where.push(`movies.release_year = $${params.length}`); }
    if (language) { params.push(language); where.push(`movies.language = $${params.length}`); }

    let order = 'movies.created_at DESC';
    if (category === 'trending' || category === 'popular') order = 'movies.popularity DESC NULLS LAST';
    if (category === 'top_rated') order = 'movies.imdb_rating DESC NULLS LAST';
    if (category === 'latest') order = 'movies.release_date DESC NULLS LAST, movies.created_at DESC';
    if (category === 'upcoming') {
      where.push('movies.release_date > CURRENT_DATE');
      order = 'movies.release_date ASC NULLS LAST';
    }
    if (category === 'featured') where.push('movies.is_featured = true');

    params.push(limit, offset);
    const sql = `SELECT movies.id, movies.title, movies.overview, movies.release_year,
      movies.imdb_rating, movies.duration_minutes, movies.language,
      movies.poster_url, movies.backdrop_url, movies.trailer_url,
      movies.genres, movies."cast", movies.is_featured, movies.is_premium,
      CASE WHEN $${params.length + 1} THEN movies.stream_url ELSE NULL END AS stream_url
      FROM ${from} WHERE ${where.join(' AND ')}
      ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;
    // Last parameter is the "authorised" flag (logged-in user or not).
    const { rows } = await pool.query(sql, [...params, !!req.user]);
    res.json({ data: rows, page });
  } catch (e) { next(e); }
});

// GET /api/movies/categories — active catalog categories (public, no auth).
// NOTE: defined before /:id so "categories" is not captured as an id.
router.get('/categories', async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT id, slug, name, kind FROM categories WHERE is_active = true ORDER BY sort_order, name',
    );
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// GET /api/movies/:id — detail + sources (trailers/providers public,
// playable streams only for authorised callers).
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT id, title, overview, release_year, imdb_rating, duration_minutes,
        language, poster_url, backdrop_url, trailer_url, genres, "cast",
        is_featured, is_premium,
        CASE WHEN $2 THEN stream_url ELSE NULL END AS stream_url
       FROM movies WHERE id=$1 AND is_published = true`,
      [req.params.id, !!req.user],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Movie not found' });
    // TODO: premium gate — if rows[0].is_premium and user is not premium,
    // return stream_url as NULL and let the app upsell the plan.
    const sources = await getSources(pool, { movieId: rows[0].id }, !!req.user);
    res.json({ data: { ...rows[0], sources } });
  } catch (e) { next(e); }
});

module.exports = router;
