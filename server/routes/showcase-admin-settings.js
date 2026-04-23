const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authRequired } = require('../middleware/auth');

// GET settings
router.get('/settings', authRequired, async (req, res) => {
  try {
    const tenantId = Number(req.query.tenant_id);
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id_required' });
    }

    const result = await pool.query(
      `
      SELECT
        tenant_id,
        is_enabled,
        show_prices,
        show_only_in_stock,
        title,
        phone,
        description,
        logo_url,
        banner_url
      FROM core.showcase_settings
      WHERE tenant_id = $1
      LIMIT 1
      `,
      [tenantId]
    );

    if (!result.rows.length) {
      return res.json({
        ok: true,
        settings: {
          tenant_id: tenantId,
          is_enabled: false,
          show_prices: true,
          show_only_in_stock: false,
          title: '',
          phone: '',
          description: '',
          logo_url: '',
          banner_url: ''
        }
      });
    }

    return res.json({
      ok: true,
      settings: result.rows[0]
    });
  } catch (error) {
    console.error('[showcase-admin/settings GET] error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

// PUT settings
router.put('/settings', authRequired, async (req, res) => {
  try {
    const tenantId = Number(req.query.tenant_id);
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id_required' });
    }

    const {
      is_enabled,
      show_prices,
      show_only_in_stock,
      title,
      phone,
      description,
      logo_url,
      banner_url
    } = req.body;

    await pool.query(
      `
      INSERT INTO core.showcase_settings (
        tenant_id,
        is_enabled,
        show_prices,
        show_only_in_stock,
        title,
        phone,
        description,
        logo_url,
        banner_url,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        show_prices = EXCLUDED.show_prices,
        show_only_in_stock = EXCLUDED.show_only_in_stock,
        title = EXCLUDED.title,
        phone = EXCLUDED.phone,
        description = EXCLUDED.description,
        logo_url = EXCLUDED.logo_url,
        banner_url = EXCLUDED.banner_url,
        updated_at = NOW()
      `,
      [
        tenantId,
        !!is_enabled,
        !!show_prices,
        !!show_only_in_stock,
        title || '',
        phone || '',
        description || '',
        logo_url || '',
        banner_url || ''
      ]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('[showcase-admin/settings PUT] error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
