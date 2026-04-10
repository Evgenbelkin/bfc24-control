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

function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

/**
 * GET /expenses
 * query:
 * - tenant_id
 * - category
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

    const category = normalizeCategory(req.query.category || "");
    const dateFrom = normalizeText(req.query.date_from || "");
    const dateTo = normalizeText(req.query.date_to || "");

    if (dateFrom && !isValidDate(dateFrom)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_date_from",
      });
    }

    if (dateTo && !isValidDate(dateTo)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_date_to",
      });
    }

    const params = [tenantId];
    let whereSql = `
      WHERE e.tenant_id = $1
    `;

    if (category) {
      params.push(category);
      whereSql += ` AND e.category = $${params.length}`;
    }

    if (dateFrom) {
      params.push(dateFrom);
      whereSql += ` AND e.expense_date >= $${params.length}::date`;
    }

    if (dateTo) {
      params.push(dateTo);
      whereSql += ` AND e.expense_date <= $${params.length}::date`;
    }

    const sql = `
      SELECT
        e.id,
        e.tenant_id,
        e.amount,
        e.category,
        e.comment,
        TO_CHAR(e.expense_date, 'YYYY-MM-DD') AS expense_date,
        e.created_by,
        u.username AS created_by_username,
        e.created_at,
        e.updated_at
      FROM core.expenses e
      LEFT JOIN saas.users u
        ON u.id = e.created_by
      ${whereSql}
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT 1000
    `;

    const { rows } = await pool.query(sql, params);

    const expenses = rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      amount: Number(row.amount),
      category: row.category,
      category_label: CATEGORY_LABELS[row.category] || row.category,
      comment: row.comment || "",
      expense_date: row.expense_date,
      created_by: row.created_by,
      created_by_username: row.created_by_username,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

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
 * GET /expenses/:id
 */
router.get("/:id", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const expenseId = Number(req.params.id);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_expense_id",
      });
    }

    const sql = `
      SELECT
        e.id,
        e.tenant_id,
        e.amount,
        e.category,
        e.comment,
        TO_CHAR(e.expense_date, 'YYYY-MM-DD') AS expense_date,
        e.created_by,
        u.username AS created_by_username,
        e.created_at,
        e.updated_at
      FROM core.expenses e
      LEFT JOIN saas.users u
        ON u.id = e.created_by
      WHERE e.id = $1
        AND e.tenant_id = $2
      LIMIT 1
    `;

    const { rows } = await pool.query(sql, [expenseId, tenantId]);
    const row = rows[0];

    if (!row) {
      return res.status(404).json({
        ok: false,
        error: "expense_not_found",
      });
    }

    return res.json({
      ok: true,
      expense: {
        id: row.id,
        tenant_id: row.tenant_id,
        amount: Number(row.amount),
        category: row.category,
        category_label: CATEGORY_LABELS[row.category] || row.category,
        comment: row.comment || "",
        expense_date: row.expense_date,
        created_by: row.created_by,
        created_by_username: row.created_by_username,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  } catch (e) {
    console.error("[GET /expenses/:id] error:", e);
    return res.status(500).json({
      ok: false,
      error: "expense_read_failed",
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
 * - comment
 * - expense_date (YYYY-MM-DD, optional)
 */
router.post("/", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const amount = Number(req.body.amount || 0);
    const category = normalizeCategory(req.body.category || "");
    const comment = normalizeText(req.body.comment || "");
    const expenseDate = normalizeText(req.body.expense_date || "");
    const createdBy = req.user?.id || null;

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

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

    if (expenseDate && !isValidDate(expenseDate)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_expense_date",
      });
    }

    const sql = `
      INSERT INTO core.expenses (
        tenant_id,
        amount,
        category,
        comment,
        expense_date,
        created_by
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        COALESCE($5::date, CURRENT_DATE),
        $6
      )
      RETURNING
        id,
        tenant_id,
        amount,
        category,
        comment,
        TO_CHAR(expense_date, 'YYYY-MM-DD') AS expense_date,
        created_by,
        created_at,
        updated_at
    `;

    const params = [
      tenantId,
      amount,
      category,
      comment || null,
      expenseDate || null,
      createdBy,
    ];

    const result = await pool.query(sql, params);
    const inserted = result.rows[0];

    let createdByUsername = null;

    if (inserted.created_by) {
      const userResult = await pool.query(
        `
        SELECT username
        FROM saas.users
        WHERE id = $1
        LIMIT 1
        `,
        [inserted.created_by]
      );
      createdByUsername = userResult.rows[0]?.username || null;
    }

    return res.status(201).json({
      ok: true,
      expense: {
        id: inserted.id,
        tenant_id: inserted.tenant_id,
        amount: Number(inserted.amount),
        category: inserted.category,
        category_label: CATEGORY_LABELS[inserted.category] || inserted.category,
        comment: inserted.comment || "",
        expense_date: inserted.expense_date,
        created_by: inserted.created_by,
        created_by_username: createdByUsername,
        created_at: inserted.created_at,
        updated_at: inserted.updated_at,
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

/**
 * PUT /expenses/:id
 * body:
 * - amount
 * - category
 * - comment
 * - expense_date
 */
router.put("/:id", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const expenseId = Number(req.params.id);

    const amount = Number(req.body.amount || 0);
    const category = normalizeCategory(req.body.category || "");
    const comment = normalizeText(req.body.comment || "");
    const expenseDate = normalizeText(req.body.expense_date || "");

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_expense_id",
      });
    }

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

    if (!expenseDate || !isValidDate(expenseDate)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_expense_date",
      });
    }

    const updateSql = `
      UPDATE core.expenses
      SET
        amount = $1,
        category = $2,
        comment = $3,
        expense_date = $4::date
      WHERE id = $5
        AND tenant_id = $6
      RETURNING
        id,
        tenant_id,
        amount,
        category,
        comment,
        TO_CHAR(expense_date, 'YYYY-MM-DD') AS expense_date,
        created_by,
        created_at,
        updated_at
    `;

    const updateParams = [
      amount,
      category,
      comment || null,
      expenseDate,
      expenseId,
      tenantId,
    ];

    const updateResult = await pool.query(updateSql, updateParams);
    const updated = updateResult.rows[0];

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: "expense_not_found",
      });
    }

    let createdByUsername = null;

    if (updated.created_by) {
      const userResult = await pool.query(
        `
        SELECT username
        FROM saas.users
        WHERE id = $1
        LIMIT 1
        `,
        [updated.created_by]
      );
      createdByUsername = userResult.rows[0]?.username || null;
    }

    return res.json({
      ok: true,
      expense: {
        id: updated.id,
        tenant_id: updated.tenant_id,
        amount: Number(updated.amount),
        category: updated.category,
        category_label: CATEGORY_LABELS[updated.category] || updated.category,
        comment: updated.comment || "",
        expense_date: updated.expense_date,
        created_by: updated.created_by,
        created_by_username: createdByUsername,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      },
    });
  } catch (e) {
    console.error("[PUT /expenses/:id] error:", e);
    return res.status(500).json({
      ok: false,
      error: "expense_update_failed",
      details: e.message,
    });
  }
});

/**
 * DELETE /expenses/:id
 */
router.delete("/:id", authRequired, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const expenseId = Number(req.params.id);

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "tenant_not_defined",
      });
    }

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_expense_id",
      });
    }

    const sql = `
      DELETE FROM core.expenses
      WHERE id = $1
        AND tenant_id = $2
      RETURNING id
    `;

    const result = await pool.query(sql, [expenseId, tenantId]);

    if (!result.rows[0]) {
      return res.status(404).json({
        ok: false,
        error: "expense_not_found",
      });
    }

    return res.json({
      ok: true,
      message: "expense_deleted",
    });
  } catch (e) {
    console.error("[DELETE /expenses/:id] error:", e);
    return res.status(500).json({
      ok: false,
      error: "expense_delete_failed",
      details: e.message,
    });
  }
});

module.exports = router;