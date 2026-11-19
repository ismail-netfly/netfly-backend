const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: !!user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '30d' },
  );
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar_url: u.avatar_url,
    is_premium: !!u.is_premium,
    premium_plan: u.premium_plan,
    premium_expires_at: u.premium_expires_at,
    is_admin: !!u.is_admin,
  };
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({ message: 'Name, valid email and 8+ char password required' });
    }
    const pool = req.app.locals.pool;
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ message: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING *',
      [name, email, hash],
    );
    res.status(201).json({ token: sign(rows[0]), user: publicUser(rows[0]) });
  } catch (e) { next(e); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash || ''))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

// POST /api/auth/google — verify Google ID token server-side.
router.post('/google', async (req, res, next) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ message: 'id_token required' });
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const p = ticket.getPayload();
    const pool = req.app.locals.pool;
    let { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [p.email]);
    let user = rows[0];
    if (!user) {
      const ins = await pool.query(
        'INSERT INTO users (name, email, avatar_url, google_id) VALUES ($1,$2,$3,$4) RETURNING *',
        [p.name, p.email, p.picture, p.sub],
      );
      user = ins.rows[0];
    }
    res.json({ token: sign(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ message: 'User not found' });
    res.json({ data: publicUser(rows[0]) });
  } catch (e) { next(e); }
});

module.exports = router;
