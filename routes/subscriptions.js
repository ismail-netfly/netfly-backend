const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Plans — keep in sync with lib/services/subscription_service.dart
// and docs/MONETIZATION.md. Prices are PKR.
const PLANS = {
  monthly: { product_id: 'netfly_premium_monthly', price_pkr: 499, days: 30 },
  quarterly: { product_id: 'netfly_premium_quarterly', price_pkr: 1299, days: 90 },
  yearly: { product_id: 'netfly_premium_yearly', price_pkr: 3999, days: 365 },
};

// GET /api/subscriptions/plans (public)
router.get('/plans', (req, res) => {
  res.json({
    data: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })),
  });
});

// POST /api/subscriptions/verify
// Body: { product_id, purchase_token }
// SECURITY: premium is ONLY granted after the server verifies the
// Google Play purchase token via the Google Play Developer API
// (androidpublisher.purchases.subscriptionsv2.get) or a trusted
// payment provider webhook. Never trust a client-side success message.
//
// TODO: implement the real Play Developer API call with a service
// account (GOOGLE_SERVICE_ACCOUNT_JSON in .env). The stub below
// REJECTS every unverified purchase — replace it, do not bypass it.
router.post('/verify', requireAuth, async (req, res, next) => {
  try {
    const { product_id, purchase_token } = req.body || {};
    if (!product_id || !purchase_token) {
      return res.status(400).json({ message: 'product_id and purchase_token required' });
    }
    const plan = Object.entries(PLANS).find(([, p]) => p.product_id === product_id);
    if (!plan) return res.status(400).json({ message: 'Unknown product' });

    // TODO: verify with Google Play Developer API here.
    // const verified = await verifyWithGooglePlay(product_id, purchase_token);
    const verified = false;
    if (!verified) {
      return res.status(402).json({
        message: 'Purchase could not be verified server-side. Premium not activated.',
      });
    }

    // On verified success only:
    // const [planId, p] = plan;
    // await pool.query(
    //   `INSERT INTO subscriptions (user_id, plan, product_id, purchase_token, status, expires_at)
    //    VALUES ($1,$2,$3,$4,'active', NOW() + ($5 || ' days')::interval)
    //    ON CONFLICT (purchase_token) DO NOTHING`,
    //   [req.user.id, planId, product_id, purchase_token, p.days]);
    // await pool.query(
    //   'UPDATE users SET is_premium=true, premium_plan=$2, premium_expires_at=NOW() + ($3 || \' days\')::interval WHERE id=$1',
    //   [req.user.id, planId, p.days]);

    res.json({ message: 'Verified — premium activated' });
  } catch (e) { next(e); }
});

module.exports = router;
