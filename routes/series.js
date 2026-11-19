const express = require('express');
const { optionalAuth } = require('../middleware/auth');
const { getSources } = require('./sourceHelpers');

const router = express.Router();

// GET /api/series?category=trending|popular|latest|top_rated|upcoming
//   &catalog=hollywood|bollywood|pakistani|korean|chinese|turkish|anime&page=
// Sections mirror /api/movies: trending/popular = popularity (trending set
// is flagged is_featured by the sync), top_rated = imdb_rating,
// latest = newest first_air_date, upcoming = first_air_date in the future.
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 24;
    const offset = (page - 1) * limit;
    const pool = req.app.locals.pool;
    const { category, catalog } = req.query;

    const where = ['series.is_published = true'];
    const params = [];
    let from = 'series';
    if (catalog) {
      params.push(catalog);
      from = `series
        JOIN series_categories sc ON sc.series_id = series.id
        JOIN categories c ON c.id = sc.category_id
          AND c.slug = $${params.length} AND c.is_active = true`;
    }
    let order = 'series.popularity DESC NULLS LAST';
    if (category === 'latest') order = 'series.first_air_date DESC NULLS LAST, series.created_at DESC';
    if (category === 'top_rated') order = 'series.imdb_rating DESC NULLS LAST';
    if (category === 'upcoming') {
      where.push('series.first_air_date > CURRENT_DATE');
      order = 'series.first_air_date ASC NULLS LAST';
    }
    if (category === 'featured') where.push('series.is_featured = true');

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT series.id, series.title, series.overview, series.release_year,
        series.imdb_rating, series.language, series.poster_url, series.backdrop_url,
        series.trailer_url, series.genres, series.is_featured
       FROM ${from} WHERE ${where.join(' AND ')}
       ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: rows, page });
  } catch (e) { next(e); }
});

// GET /api/series/:id — with seasons + episodes (stream URLs gated) + sources.
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT * FROM series WHERE id=$1 AND is_published = true',
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ message: 'Series not found' });
    const series = rows[0];
    const seasonsRes = await pool.query(
      'SELECT * FROM seasons WHERE series_id=$1 ORDER BY season_number',
      [series.id],
    );
    const seasons = [];
    for (const s of seasonsRes.rows) {
      const eps = await pool.query(
        `SELECT id, season_id, episode_number, title, overview,
          duration_minutes, thumbnail_url,
          CASE WHEN $2 THEN stream_url ELSE NULL END AS stream_url
         FROM episodes WHERE season_id=$1 ORDER BY episode_number`,
        [s.id, !!req.user],
      );
      seasons.push({ ...s, episodes: eps.rows });
    }
    const sources = await getSources(pool, { seriesId: series.id }, !!req.user);
    res.json({ data: { ...series, seasons, sources } });
  } catch (e) { next(e); }
});

module.exports = router;
