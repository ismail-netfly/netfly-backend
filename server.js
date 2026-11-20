// NETFLY backend — Node.js + Express + PostgreSQL.
// Run:  cp .env.example .env   (fill real values, never commit .env)
//       npm install && npm start
// See docs/README.md, docs/API.md and docs/DATABASE.md.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Shared DB pool — routes import it from here.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.locals.pool = pool;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));

// Basic abuse protection.
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 600 }));

app.get('/health', (req, res) => res.json({ ok: true, app: 'netfly' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/titles', require('./routes/titles'));
app.use('/api/series', require('./routes/series'));
app.use('/api/search', require('./routes/search'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/history', require('./routes/history'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/admin', require('./routes/admin'));

// Central error handler — never leak stack traces in production.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

app.listen(PORT, () => console.log(`NETFLY API listening on :${PORT}`));
module.exports = app;
