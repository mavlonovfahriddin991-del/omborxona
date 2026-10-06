const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("./src/config");
const { db, getSetting, getSettingStr, setSetting, genRefCode } = require("./src/db");
const { verifyOpenBudgetId } = require("./src/openbudget");
const { setOrderStatus, STATUS_UZ } = require("./src/orders");
const { startBot, notifyAdmins } = require("./src/bot");

const app = express();
app.use(express.json());
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const uploadsDir = path.join(__dirname, "uploads");
if (!require("fs").existsSync(uploadsDir)) require("fs").mkdirSync(uploadsDir);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || ".jpg").toLowerCase().slice(0, 6);
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error("Faqat rasm yuklang"));
  },
});

app.use((req, _res, next) => {
  if (req.session.userId) req.user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId) || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.user || req.user.banned) return res.status(401).json({ error: "Avval tizimga kiring" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin || req.user.banned) return res.status(403).json({ error: "Ruxsat yo'q" });
  next();
}

function credit(userId, amount, type, note) {
  db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, userId);
  db.prepare("INSERT INTO transactions (user_id, amount, type, note) VALUES (?, ?, ?, ?)").run(userId, amount, type, note);
}

function publicUser(u) {
  return { id: u.id, username: u.username, balance: u.balance, ref_code: u.ref_code };
}

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Login 3-20 ta lotin harf/raqam bo'lsin" });
  if (password.length < 5) return res.status(400).json({ error: "Parol kamida 5 belgi" });
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) return res.status(400).json({ error: "Bu login band" });
  let refBy = null;
  const refCode = String(req.body.ref || req.session.refCode || "").toUpperCase();
  if (refCode && /^[A-F0-9]{6,10}$/.test(refCode)) {
    const r = db.prepare("SELECT id FROM users WHERE ref_code = ?").get(refCode);
    if (r) refBy = r.id;
  }
  const bonus = getSetting("signup_bonus", 0);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, balance, ref_code, ref_by) VALUES (?, ?, ?, ?, ?)")
    .run(username, bcrypt.hashSync(password, 10), 0, genRefCode(), refBy);
  const uid = Number(info.lastInsertRowid);
  if (bonus > 0) credit(uid, bonus, "bonus", "Ro'yxatdan o'tish bonusi");
  delete req.session.refCode;
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(uid);
  req.session.userId = uid;
  res.json({ ok: true, user: publicUser(u), is_admin: false, redirect: "/" });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!u || !u.password_hash || !bcrypt.compareSync(String(req.body.password || ""), u.password_hash))
    return res.status(401).json({ error: "Login yoki parol xato" });
  if (u.banned) return res.status(403).json({ error: "Akkaunt bloklangan" });
  req.session.userId = u.id;
  res.json({ ok: true, user: publicUser(u), is_admin: !!u.is_admin, redirect: u.is_admin ? `/${config.adminPath}` : "/" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/services", (_req, res) => {
  res.json({
    services: db.prepare("SELECT id, name, price FROM services WHERE active = 1 ORDER BY sort, id").all(),
    target: getSettingStr("target_ob_id", ""),
  });
});

app.post("/api/check-id", requireAuth, async (req, res) => {
  const r = await verifyOpenBudgetId(req.body.ob_id, config.openbudgetApi);
  if (!r.ok) return res.status(400).json({ error: r.reason === "format" ? "ID formati noto'g'ri" : "Bunday OpenBudget ID topilmadi" });
  res.json({ ok: true });
});

app.get("/api/vote-info", requireAuth, (req, res) => {
  const fresh = db.prepare("SELECT balance FROM users WHERE id = ?").get(req.user.id);
  res.json({
    target: getSettingStr("target_ob_id", ""),
    reward: getSetting("vote_reward", 0),
    balance: fresh.balance,
  });
});

app.post("/api/vote-proof", requireAuth, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Skrinshot yuklang" });
  const target = getSettingStr("target_ob_id", "");
  if (!target) return res.status(400).json({ error: "Hozircha ovoz berish yoqilmagan" });
  const fresh = db.prepare("SELECT banned FROM users WHERE id = ?").get(req.user.id);
  if (fresh.banned) return res.status(403).json({ error: "Akkaunt bloklangan" });
  const reward = getSetting("vote_reward", 0);
  const info = db
    .prepare("INSERT INTO orders (user_id, ob_id, service_id, service_name, amount, status, proof_image) VALUES (?, ?, 0, 'Ovoz', ?, 'checking', ?)")
    .run(req.user.id, target, reward, "/uploads/" + req.file.filename);
  notifyAdmins(
    `🗳 Yangi ovoz tekshiruvi #${info.lastInsertRowid}\nMijoz: ${req.user.username}\nID: ${target}\nMukofot: ${reward} so'm\n\nTasdiqlash: /holat ${info.lastInsertRowid} bajarildi`
  );
  res.json({ ok: true, order_id: Number(info.lastInsertRowid), status: "checking" });
});

function verifyTelegramInitData(initData) {
  if (!initData || !config.botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(config.botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computed !== hash) return null;
  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

app.post("/api/tg-auth", (req, res) => {
  const tgUser = verifyTelegramInitData(req.body.initData || "");
  if (!tgUser) return res.status(401).json({ error: "Telegram imzosi noto'g'ri" });
  let user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(tgUser.id);
  if (user && user.banned) return res.status(403).json({ error: "Akkaunt bloklangan" });
  if (!user) {
    const { ensureBotUser } = require("./src/bot");
    user = ensureBotUser({ id: tgUser.id, username: tgUser.username, first_name: tgUser.first_name }, req.session.refCode || "");
  }
  req.session.userId = user.id;
  res.json({ ok: true, user: { id: user.id, username: user.username, balance: user.balance } });
});

app.get("/api/my-orders", requireAuth, (req, res) => {
  res.json({ orders: db.prepare("SELECT id, ob_id, service_name, amount, status, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(req.user.id) });
});

app.get("/api/referral", requireAuth, (req, res) => {
  const s = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM transactions WHERE user_id = ? AND type = 'referral'").get(req.user.id);
  const invited = db.prepare("SELECT COUNT(*) c FROM users WHERE ref_by = ?").get(req.user.id).c;
  res.json({ link: `${config.baseUrl}/ref/${req.user.ref_code}`, invited, earned: s.s, reward: getSetting("ref_reward", 0) });
});

app.get("/ref/:code", (req, res) => {
  if (/^[A-F0-9]{6,10}$/.test(req.params.code.toUpperCase())) req.session.refCode = req.params.code.toUpperCase();
  res.redirect("/");
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/orders", (_req, res) => res.sendFile(path.join(__dirname, "public", "orders.html")));
app.get("/profile", (_req, res) => res.sendFile(path.join(__dirname, "public", "profile.html")));

app.get(`/${config.adminPath}`, (req, res) => {
  if (req.user && req.user.is_admin && !req.user.banned)
    return res.sendFile(path.join(__dirname, "public", "admin.html"));
  res.status(403).sendFile(path.join(__dirname, "public", "no-access.html"));
});
app.use("/api/admin", requireAdmin);

app.get("/api/admin/stats", (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    users: one("SELECT COUNT(*) c FROM users").c,
    new_users_today: one("SELECT COUNT(*) c FROM users WHERE date(created_at)=date('now')").c,
    orders_total: one("SELECT COUNT(*) c FROM orders").c,
    orders_checking: one("SELECT COUNT(*) c FROM orders WHERE status='checking'").c,
    orders_pending: one("SELECT COUNT(*) c FROM orders WHERE status='pending'").c,
    orders_processing: one("SELECT COUNT(*) c FROM orders WHERE status='processing'").c,
    orders_done: one("SELECT COUNT(*) c FROM orders WHERE status='done'").c,
    revenue: one("SELECT COALESCE(SUM(amount),0) s FROM orders WHERE status='done'").s,
    balances: one("SELECT COALESCE(SUM(balance),0) s FROM users").s,
  });
});

app.get("/api/admin/settings", (_req, res) =>
  res.json({
    target_ob_id: getSettingStr("target_ob_id", ""),
    vote_reward: getSetting("vote_reward", 0),
    ref_reward: getSetting("ref_reward", 0),
  })
);
app.put("/api/admin/settings", (req, res) => {
  if (req.body.target_ob_id !== undefined) {
    const t = String(req.body.target_ob_id).trim();
    if (t && !/^\d{4,20}$/.test(t)) return res.status(400).json({ error: "OB ID faqat raqam bo'lsin" });
    setSetting("target_ob_id", t);
  }
  for (const k of ["vote_reward", "ref_reward"]) {
    const v = Number(req.body[k]);
    if (Number.isFinite(v) && v >= 0) setSetting(k, Math.floor(v));
  }
  res.json({ ok: true });
});

app.get("/api/admin/services", (_req, res) => res.json({ services: db.prepare("SELECT * FROM services ORDER BY sort, id").all() }));
app.post("/api/admin/services", (req, res) => {
  const name = String(req.body.name || "").trim();
  const price = Math.floor(Number(req.body.price));
  if (!name || !(price >= 0)) return res.status(400).json({ error: "Nomi va narxni to'g'ri kiriting" });
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort),0) m FROM services").get().m;
  db.prepare("INSERT INTO services (name, price, kind, sort) VALUES (?, ?, 'other', ?)").run(name, price, maxSort + 1);
  res.json({ ok: true });
});
app.put("/api/admin/services/:id", (req, res) => {
  const s = db.prepare("SELECT * FROM services WHERE id = ?").get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: "Topilmadi" });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : s.name;
  const price = req.body.price !== undefined ? Math.floor(Number(req.body.price)) : s.price;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : s.active;
  if (!(price >= 0) || !name) return res.status(400).json({ error: "Notog'ri ma'lumot" });
  db.prepare("UPDATE services SET name=?, price=?, active=? WHERE id=?").run(name, price, active, s.id);
  if (s.kind === "id") setSetting("id_price", price);
  res.json({ ok: true });
});
app.delete("/api/admin/services/:id", (req, res) => {
  const s = db.prepare("SELECT kind FROM services WHERE id = ?").get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: "Topilmadi" });
  if (s.kind === "id") return res.status(400).json({ error: "Asosiy ID xizmatini o'chirib bo'lmaydi" });
  db.prepare("DELETE FROM services WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.put("/api/admin/orders/:id", (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Buyurtma topilmadi" });
  if (req.body.ob_id !== undefined) {
    const obId = String(req.body.ob_id).trim();
    if (obId && !/^[A-Za-z0-9-]{3,30}$/.test(obId)) return res.status(400).json({ error: "OB ID faqat harf/raqam" });
    db.prepare("UPDATE orders SET ob_id = ? WHERE id = ?").run(obId, o.id);
  }
  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id);
  res.json({ ok: true, order: updated });
});

app.get("/api/admin/orders", (req, res) => {
  const status = req.query.status;
  const rows =
    status && STATUS_UZ[status]
      ? db.prepare("SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status=? ORDER BY o.id DESC LIMIT 300").all(status)      : db.prepare("SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 300").all();
  res.json({ orders: rows });
});

app.put("/api/admin/orders/:id/status", (req, res) => {
  const status = String(req.body.status || "");
  const r = setOrderStatus(req.params.id, status);
  if (!r.ok) return res.status(r.error === "Buyurtma topilmadi" ? 404 : 400).json({ error: r.error });
  res.json({ ok: true });
});

app.get("/api/admin/users", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const rows = q
    ? db.prepare("SELECT id, username, telegram_username, balance, ref_code, ref_by, is_admin, banned, created_at FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 200").all(`%${q}%`)
    : db.prepare("SELECT id, username, telegram_username, balance, ref_code, ref_by, is_admin, banned, created_at FROM users ORDER BY id DESC LIMIT 200").all();
  res.json({ users: rows });
});

app.put("/api/admin/users/:id", (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
  const delta = Math.floor(Number(req.body.balance_delta) || 0);
  if (delta !== 0) credit(u.id, delta, delta > 0 ? "topup" : "adjust", delta > 0 ? "Balans to'ldirildi (admin)" : "Balans tushirildi (admin)");
  const banned = req.body.banned !== undefined ? (req.body.banned ? 1 : 0) : u.banned;
  const isAdmin = req.body.is_admin !== undefined ? (req.body.is_admin ? 1 : 0) : u.is_admin;
  if (u.id === req.user.id && !isAdmin) return res.status(400).json({ error: "O'zingizni adminlikdan ololmaysiz" });
  db.prepare("UPDATE users SET banned = ?, is_admin = ? WHERE id = ?").run(banned, isAdmin, u.id);
  res.json({ ok: true });
});

app.get("/api/admin/transactions", (_req, res) => {
  res.json({
    transactions: db
      .prepare("SELECT t.*, u.username FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 200")
      .all(),
  });
});

app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

(async () => {
  if (!db.prepare("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1").get()) {
    db.prepare("INSERT INTO users (username, password_hash, is_admin, ref_code) VALUES (?, ?, 1, ?)").run(
      config.adminUsername,
      bcrypt.hashSync(config.adminPassword, 10),
      genRefCode()
    );
    console.log(`[admin] Yaratildi — login: ${config.adminUsername} / parol: .env dagi ADMIN_PASSWORD`);
  }
  app.listen(config.port, () => console.log(`[web] http://localhost:${config.port}`));
  if (!process.env.DISABLE_BOT) startBot().catch((e) => console.log("[bot]", e.message));
})();

process.on("SIGINT", () => process.exit(0));
