require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const pool = require("./db");

const authRoutes = require("./routes/auth");
const itemRoutes = require("./routes/items");
const locationRoutes = require("./routes/locations");
const clientRoutes = require("./routes/clients");
const stockRoutes = require("./routes/stock");
const salesRoutes = require("./routes/sales");
const writeoffRoutes = require("./routes/writeoff");
const debtRoutes = require("./routes/debts");
const cashRoutes = require("./routes/cash");
const expensesRoutes = require("./routes/expenses");
const ownerAdminRoutes = require("./routes/owner-admin");
const ownerActivityRoutes = require('./routes/owner-activity');

const app = express();

const PORT = Number(process.env.PORT || 3003);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));

app.get("/ping", async (req, res) => {
  try {
    const db = await pool.query(`
      SELECT
        NOW() AS db_time,
        current_database() AS db_name
    `);

    res.json({
      ok: true,
      db: db.rows[0]
    });
  } catch (e) {
    console.error("[GET /ping] error:", e);
    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

app.use("/auth", authRoutes);
app.use("/items", itemRoutes);
app.use("/locations", locationRoutes);
app.use("/clients", clientRoutes);
app.use("/stock", stockRoutes);
app.use("/sales", salesRoutes);
app.use("/writeoff", writeoffRoutes);
app.use("/debts", debtRoutes);
app.use("/cash", cashRoutes);
app.use("/expenses", expensesRoutes);
app.use("/owner-admin", ownerAdminRoutes);
app.use('/owner-activity', authRequired, requireRole('owner'), ownerActivityRoutes);

app.get("/", (req, res) => {
  const menuPath = path.join(PUBLIC_DIR, "menu.html");
  const indexPath = path.join(PUBLIC_DIR, "index.html");

  res.sendFile(menuPath, (err) => {
    if (err) {
      res.sendFile(indexPath);
    }
  });
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    path: req.originalUrl
  });
});

app.use((err, req, res, next) => {
  console.error("[UNHANDLED ERROR]", err);

  res.status(500).json({
    ok: false,
    error: "internal_server_error",
    details: err.message
  });
});

app.listen(PORT, () => {
  console.log("SERVER STARTED");
  console.log(`http://localhost:${PORT}`);
  console.log(`PUBLIC_DIR: ${PUBLIC_DIR}`);
});