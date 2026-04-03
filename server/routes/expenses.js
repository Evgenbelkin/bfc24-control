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

const ALLOWED_PAYMENT_METHODS = new Set([
  "cash",
  "card",
  "transfer",
]);

function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePaymentMethod(value) {
  return String(value || "").trim().toLowerCase();
}

function encodeExpenseComment(category, comment) {
  const cleanCategory = normalizeCategory(category);
  const cleanComment = String(comment || "").trim();

  if (!cleanCategory) {
    return cleanComment;
  }

  return `[#category=${cleanCategory}] ${cleanComment}`.trim();
}

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

  const category = normalizeCategory(match[1]);
  const cleanComment = source.replace(/^\[#category=([a-z_]+)\]\s*/i, "").trim();

  return {
    category,
    category_label: CATEGORY_LABELS[category] || category,
    clean_comment: cleanComment,
  };
}

/**
 * GET /expenses
 * Фильтры:
 * - tenant_id
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

    const paymentMethod = normalizePaymentMethod(req.query.payment_method || "");
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();

    const params = [tenantId];
    let whereSql = `
      WHERE ct.tenant_id = $1
        AND ct.transaction_type = 'expense'
    `;

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
        ct.amount,
        ct.payment_method,
        ct.comment,
        ct.created_by,
        u.username AS created_by_username,
        ct.created_at
      FROM core.cash_transactions ct
      LEFT JOIN saas.users u ON u.id = ct.created_by
      ${whereSql}
      ORDER BY ct.id DESC
      LIMIT 500
    `;

    const { rows } = await pool.query(sql, params);

    const expenses = rows.map((row) => {
      const parsed = parseExpenseComment(row.comment);

      return {
        id: row.id,
        tenant_id: row.tenant_id,
        amount: row.amount,
        payment_method: row.payment_method,
        category: parsed.category,
        category_label: parsed.category_label,
        comment: parsed.clean_comment,
        created_by: row.created_by,
        created_by_username: row.created_by_username,
        created_at: row.created_at,
      };
    });

    return res.json({
      ok: true,
      expenses,
      categories: CATEGORY_LABELS,
    });
  } catch (e) {
    console.error("[GET /expenses] error:", e);
    return res.status(500).json({
      ok: false,
      error: "expenses_list_failed",
      details: e.message,
    });
  }
});

/**
 * POST /expenses
 * body:
 * - tenant_id
 * - amount
 * - category
 * - payment_method
 * - comment
 * - expense_date (YYYY-MM-DD, optional)
 */
router.post("/", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    const amount = Number(req.body.amount || 0);
    const category = normalizeCategory(req.body.category || "");
    const paymentMethod = normalizePaymentMethod(req.body.payment_method || "");
    const comment = String(req.body.comment || "").trim();
    const expenseDate = String(req.body.expense_date || "").trim();
    const createdBy = req.user?.id || null;

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_amount",
      });
    }

    if (!category || !CATEGORY_LABELS[category]) {
      return res.status(400).json({
        ok: false,
        error: "invalid_category",
      });
    }

    if (!paymentMethod || !ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payment_method",
      });
    }

    if (expenseDate && !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_expense_date",
      });
    }

    const encodedComment = encodeExpenseComment(category, comment);
    const createdAtValue = expenseDate ? `${expenseDate} 12:00:00` : null;

    const insertSql = `
      INSERT INTO core.cash_transactions (
        tenant_id,
        transaction_type,
        amount,
        payment_method,
        counterparty_id,
        comment,
        created_by,
        created_at
      )
      VALUES (
        $1,
        'expense',
        $2,
        $3,
        NULL,
        $4,
        $5,
        COALESCE($6::timestamp, NOW())
      )
      RETURNING
        id,
        tenant_id,
        transaction_type,
        amount,
        payment_method,
        comment,
        created_by,
        created_at
    `;

    const insertParams = [
      tenantId,
      amount,
      paymentMethod,
      encodedComment,
      createdBy,
      createdAtValue,
    ];

    const insertResult = await pool.query(insertSql, insertParams);
    const inserted = insertResult.rows[0];

    const userSql = `
      SELECT username
      FROM saas.users
      WHERE id = $1
      LIMIT 1
    `;

    let createdByUsername = null;
    if (inserted.created_by) {
      const userResult = await pool.query(userSql, [inserted.created_by]);
      createdByUsername = userResult.rows[0]?.username || null;
    }

    const parsed = parseExpenseComment(inserted.comment);

    return res.status(201).json({
      ok: true,
      expense: {
        id: inserted.id,
        tenant_id: inserted.tenant_id,
        transaction_type: inserted.transaction_type,
        amount: inserted.amount,
        payment_method: inserted.payment_method,
        category: parsed.category,
        category_label: parsed.category_label,
        comment: parsed.clean_comment,
        created_by: inserted.created_by,
        created_by_username: createdByUsername,
        created_at: inserted.created_at,
      },
    });
  } catch (e) {
    console.error("[POST /expenses] error:", e);
    return res.status(500).json({
      ok: false,
      error: "expense_create_failed",
      details: e.message,
    });
  }
});

module.exports = router;