const express = require("express");
const pool = require("../db");
const {
  authRequired,
  getEffectiveTenantId,
} = require("../middleware/auth");

const router = express.Router();

const CATEGORY_LABELS = {
  rent: "Аренда",
  salary: "Зарплата",
  purchase: "Закупка",
  delivery: "Доставка",
  ads: "Реклама",
  utilities: "Коммунальные",
  other: "Прочее",
};

function parseExpenseComment(rawComment) {
  const source = String(rawComment || "");
  const match = source.match(/^\[#category=([a-z_]+)\]\s*/i);

  if (!match) {
    return {
      category: "",
      category_label: "",
      clean_comment: source,
    };
  }

  const category = String(match[1] || "").trim().toLowerCase();
  const cleanComment = source.replace(/^\[#category=([a-z_]+)\]\s*/i, "").trim();

  return {
    category,
    category_label: CATEGORY_LABELS[category] || category,
    clean_comment: cleanComment,
  };
}

/**
 * GET /cash
 * Фильтры:
 * - tenant_id
 * - transaction_type
 * - payment_method
 * - date_from (YYYY-MM-DD)
 * - date_to   (YYYY-MM-DD)
 */
router.get("/", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    const transactionType = String(req.query.transaction_type || "").trim();
    const paymentMethod = String(req.query.payment_method || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const params = [tenantId];
    let whereSql = `WHERE ct.tenant_id = $1`;

    if (transactionType) {
      params.push(transactionType);
      whereSql += ` AND ct.transaction_type = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      whereSql += ` AND ct.payment_method = $${params.length}`;
    }

    if (dateFrom) {
      params.push(dateFrom);
      whereSql += ` AND ct.created_at >= $${params.length}::date`;
    }

    if (dateTo) {
      params.push(dateTo);
      whereSql += ` AND ct.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }

    const sql = `
      SELECT
        ct.id,
        ct.tenant_id,
        ct.transaction_type,
        ct.amount,
        ct.payment_method,
        ct.counterparty_id,
        cp.name AS counterparty_name,
        ct.comment,
        ct.created_by,
        u.username AS created_by_username,
        ct.created_at
      FROM core.cash_transactions ct
      LEFT JOIN core.counterparties cp ON cp.id = ct.counterparty_id
      LEFT JOIN saas.users u ON u.id = ct.created_by
      ${whereSql}
      ORDER BY ct.id DESC
      LIMIT 500
    `;

    const { rows } = await pool.query(sql, params);

    const cash = rows.map((row) => {
      const parsed = parseExpenseComment(row.comment);

      return {
        ...row,
        category: row.transaction_type === "expense" ? parsed.category_label : "",
        comment: parsed.clean_comment,
      };
    });

    return res.json({
      ok: true,
      cash,
    });
  } catch (e) {
    console.error("[GET /cash] error:", e);
    return res.status(500).json({
      ok: false,
      error: "cash_list_failed",
      details: e.message,
    });
  }
});

/**
 * GET /cash/summary
 * Краткая сводка по фильтрам
 */
router.get("/summary", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    const transactionType = String(req.query.transaction_type || "").trim();
    const paymentMethod = String(req.query.payment_method || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const params = [tenantId];
    let whereSql = `WHERE tenant_id = $1`;

    if (transactionType) {
      params.push(transactionType);
      whereSql += ` AND transaction_type = $${params.length}`;
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      whereSql += ` AND payment_method = $${params.length}`;
    }

    if (dateFrom) {
      params.push(dateFrom);
      whereSql += ` AND created_at >= $${params.length}::date`;
    }

    if (dateTo) {
      params.push(dateTo);
      whereSql += ` AND created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }

    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0) AS expense_total,
        COALESCE(SUM(CASE
          WHEN transaction_type = 'income' THEN amount
          WHEN transaction_type = 'expense' THEN -amount
          ELSE 0
        END), 0) AS balance
      FROM core.cash_transactions
      ${whereSql}
    `;

    const { rows } = await pool.query(sql, params);

    return res.json({
      ok: true,
      summary: rows[0],
    });
  } catch (e) {
    console.error("[GET /cash/summary] error:", e);
    return res.status(500).json({
      ok: false,
      error: "cash_summary_failed",
      details: e.message,
    });
  }
});

module.exports = router;