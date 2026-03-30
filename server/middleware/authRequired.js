const jwt = require("jsonwebtoken");

module.exports = function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Токен не передан" });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch (e) {
    console.error("[authRequired] error:", e.message);
    return res.status(401).json({ error: "Неверный токен" });
  }
};