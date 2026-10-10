const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { db, ORDER_STATUS, TAXI_STATUS, deliveryRange } = require("./db");

const app = express();
const PORT = process.env.MARKET_PORT || 3001;

app.use(express.json());
app.use(
  session({
    secret: process.env.MARKET_SECRET || "market-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  req.user = req.session.userId
    ? db.prepare("SELECT id, username, is_admin, google_email, google_name, banned FROM users WHERE id = ?").get(req.session.userId) || null
    : null;
  next();
});

function auth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Avval tizimga kiring" });
  if (req.user.banned) return res.status(403).json({ error: "Akkaunt bloklangan" });
  next();
}
function admin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).json({ error: "Ruxsat yo'q" });
  next();
}

// ---------- AUTH ----------
app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: "Login 3-20 ta harf/raqam bo'lsin" });
  if (password.length < 5) return res.status(400).json({ error: "Parol kamida 5 belgi bo'lsin" });
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username))
    return res.status(400).json({ error: "Bu login band" });
  const info = db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, bcrypt.hashSync(password, 10));
  req.session.userId = Number(info.lastInsertRowid);
  res.json({ ok: true, user: { id: info.lastInsertRowid, username } });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!u || !bcrypt.compareSync(String(req.body.password || ""), u.password_hash))
    return res.status(401).json({ error: "Login yoki parol xato" });
  if (u.banned) return res.status(403).json({ error: "Akkaunt bloklangan" });
  req.session.userId = u.id;
  res.json({ ok: true, user: { id: u.id, username: u.username }, is_admin: !!u.is_admin });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", (req, res) => res.json({ user: req.user || null }));

// ---------- GOOGLE (rasmiy OAuth yoki demo rejim) ----------
app.get("/api/config", (_req, res) => res.json({ google_client_id: process.env.GOOGLE_CLIENT_ID || "" }));

async function verifyGoogleToken(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.aud !== clientId || !d.email) return null;
    return { email: d.email, name: d.name || d.email };
  } catch {
    return null;
  }
}

function uniqueUsername(base) {
  let b = String(base).replace(/[^a-z0-9_]/gi, "").toLowerCase();
  if (b.length < 3) b = "user" + (b || Math.floor(Math.random() * 999));
  let name = b, i = 1;
  while (db.prepare("SELECT 1 FROM users WHERE username = ?").get(name)) name = b + "_" + ++i;
  return name;
}

app.post("/api/google-login", async (req, res) => {
  let email = "", name = "";
  if (req.body.credential) {
    const v = await verifyGoogleToken(String(req.body.credential));
    if (!v) return res.status(401).json({ error: "Google hisobini tasdiqlab bo'lmadi" });
    email = v.email;
    name = v.name;
  } else {
    email = String(req.body.email || "").trim().toLowerCase();
    name = String(req.body.name || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "To'g'ri Google pochta manzilini kiriting" });
    if (!name) name = email.split("@")[0];
  }
  let u = db.prepare("SELECT * FROM users WHERE google_email = ?").get(email);
  let created = false;
  if (!u) {
    const info = db
      .prepare("INSERT INTO users (username, password_hash, google_email, google_name) VALUES (?, ?, ?, ?)")
      .run(uniqueUsername(email.split("@")[0]), bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 10), email, name);
    u = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(info.lastInsertRowid));
    created = true;
  }
  if (u.banned) return res.status(403).json({ error: "Akkaunt bloklangan" });
  req.session.userId = u.id;
  res.json({
    ok: true,
    created,
    user: { id: u.id, username: u.username, is_admin: !!u.is_admin, google_email: u.google_email, google_name: u.google_name || name },
  });
});

// ---------- KATALOG ----------
app.get("/api/categories", (_req, res) =>
  res.json({ categories: db.prepare("SELECT * FROM categories ORDER BY sort, id").all() })
);

app.get("/api/products", (req, res) => {
  const cat = Number(req.query.cat) || 0;
  const q = String(req.query.q || "").trim();
  let rows = db.prepare("SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id=p.category_id WHERE p.active=1").all();
  if (cat) rows = rows.filter((r) => r.category_id === cat);
  if (q) rows = rows.filter((r) => (r.name + " " + r.category).toLowerCase().includes(q.toLowerCase()));
  const stock = db.prepare(
    "SELECT s.product_id, SUM(s.qty) qty, COUNT(DISTINCT s.warehouse_id) whs, GROUP_CONCAT(DISTINCT w.city) cities FROM stocks s JOIN warehouses w ON w.id=s.warehouse_id GROUP BY s.product_id"
  );
  const smap = {};
  stock.all().forEach((r) => (smap[r.product_id] = r));
  res.json({
    products: rows.map((p) => ({
      ...p,
      qty: smap[p.id] ? smap[p.id].qty : 0,
      warehouses: smap[p.id] ? smap[p.id].whs : 0,
      delivery: smap[p.id] && smap[p.id].cities ? deliveryRange(String(smap[p.id].cities).split(",")) : "3-5 kun",
    })),
  });
});

app.get("/api/warehouses", (_req, res) =>
  res.json({ warehouses: db.prepare("SELECT * FROM warehouses ORDER BY id").all() })
);

// ---------- OZIQ-OVQAT ----------
app.get("/api/food", (_req, res) => {
  const places = db.prepare("SELECT * FROM food_places ORDER BY id").all();
  const items = db.prepare("SELECT * FROM food_items WHERE active=1").all();
  res.json({
    places: places.map((p) => ({ ...p, items: items.filter((i) => i.place_id === p.id) })),
  });
});

// ---------- MANZIL ----------
app.get("/api/addresses", auth, (req, res) =>
  res.json({ addresses: db.prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY id DESC").all(req.user.id) })
);

app.post("/api/addresses", auth, (req, res) => {
  const title = String(req.body.title || "").trim();
  const text = String(req.body.text || "").trim();
  const phone = String(req.body.phone || "").trim();
  if (!title || !text) return res.status(400).json({ error: "Manzil nomi va manzilni to'ldiring" });
  const info = db
    .prepare("INSERT INTO addresses (user_id, title, text, phone) VALUES (?, ?, ?, ?)")
    .run(req.user.id, title, text, phone);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.delete("/api/addresses/:id", auth, (req, res) => {
  db.prepare("DELETE FROM addresses WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- BUYURTMA (savat) ----------
app.post("/api/orders", auth, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "Savat bo'sh" });
  const addressId = Number(req.body.address_id) || 0;
  const addr = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(addressId, req.user.id);
  if (!addr) return res.status(400).json({ error: "Avval savatda manzilingizni belgilang" });

  const whs = db.prepare("SELECT id, name, city FROM warehouses ORDER BY id").all();
  const getProd = db.prepare("SELECT * FROM products WHERE id = ? AND active = 1");
  const getStock = db.prepare("SELECT * FROM stocks WHERE product_id = ? AND warehouse_id = ?");

  const lines = [];
  const whUsed = {};
  let total = 0;

  for (const it of items) {
    const pid = Number(it.id);
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    const p = getProd.get(pid);
    if (!p) return res.status(400).json({ error: `Tovar topilmadi (id: ${pid})` });
    let need = qty;
    const assigned = [];
    for (const w of whs) {
      if (need <= 0) break;
      const st = getStock.get(pid, w.id);
      if (st && st.qty > 0) {
        const take = Math.min(need, st.qty);
        assigned.push({ warehouse_id: w.id, name: w.name, qty: take });
        whUsed[w.id] = whUsed[w.id] || { id: w.id, name: w.name, city: w.city, count: 0 };
        whUsed[w.id].count += take;
        need -= take;
      }
    }
    if (need > 0)
      return res.status(400).json({ error: `«${p.name}» omborda yetarli emas (yetishmadi: ${need} dona)` });
    lines.push({ id: p.id, name: p.name, price: p.price, emoji: p.emoji, qty, from: assigned });
    total += p.price * qty;
  }

  for (const l of lines)
    for (const a of l.from)
      db.prepare("UPDATE stocks SET qty = qty - ? WHERE product_id = ? AND warehouse_id = ?").run(
        a.qty, l.id, a.warehouse_id
      );

  const usedWh = Object.values(whUsed);
  const delivery = deliveryRange(usedWh.map((w) => w.city));
  const info = db
    .prepare(
      "INSERT INTO orders (user_id, type, items, address_id, address_text, total, status, warehouses, delivery) VALUES (?, ?, ?, ?, ?, ?, 'yangi', ?, ?)"
    )
    .run(req.user.id, "market", JSON.stringify(lines), addr.id, `${addr.title}: ${addr.text}`, total, JSON.stringify(usedWh), delivery);
  res.json({ ok: true, id: Number(info.lastInsertRowid), total, warehouses: usedWh, delivery });
});

app.post("/api/food-orders", auth, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "Savat bo'sh" });
  const addressId = Number(req.body.address_id) || 0;
  const addr = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(addressId, req.user.id);
  if (!addr) return res.status(400).json({ error: "Avval savatda manzilingizni belgilang" });

  const get = db.prepare("SELECT * FROM food_items WHERE id = ? AND active = 1");
  const lines = [];
  let total = 0;
  for (const it of items) {
    const f = get.get(Number(it.id));
    if (!f) return res.status(400).json({ error: "Taom topilmadi" });
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    lines.push({ id: f.id, name: f.name, price: f.price, emoji: f.emoji, qty });
    total += f.price * qty;
  }
  const info = db
    .prepare(
      "INSERT INTO orders (user_id, type, items, address_id, address_text, total, status, warehouses, delivery) VALUES (?, 'food', ?, ?, ?, ?, 'yangi', '[]', '30-45 daqiqa')"
    )
    .run(req.user.id, JSON.stringify(lines), addr.id, `${addr.title}: ${addr.text}`, total);
  res.json({ ok: true, id: Number(info.lastInsertRowid), total, delivery: "30-45 daqiqa" });
});

app.get("/api/orders", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(req.user.id);
  res.json({
    orders: rows.map((o) => ({ ...o, items: JSON.parse(o.items), warehouses: JSON.parse(o.warehouses) })),
  });
});

app.post("/api/orders/:id/cancel", auth, (req, res) => {
  const o = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.user.id);
  if (!o) return res.status(404).json({ error: "Buyurtma topilmadi" });
  if (!["yangi", "tasdiqlandi"].includes(o.status))
    return res.status(400).json({ error: "Bu buyurtmani endi bekor qilib bo'lmaydi" });
  if (o.type === "market") {
    const lines = JSON.parse(o.items);
    for (const l of lines)
      for (const a of l.from || [])
        db.prepare("UPDATE stocks SET qty = qty + ? WHERE product_id = ? AND warehouse_id = ?").run(
          a.qty, l.id, a.warehouse_id
        );
  }
  db.prepare("UPDATE orders SET status = 'bekor qilindi' WHERE id = ?").run(o.id);
  res.json({ ok: true });
});

// ---------- TAKSI ----------
const TAXI_CLASSES = {
  ekoi: { name: "Ekoi", base: 5000, perKm: 2500, emoji: "🚗" },
  komfort: { name: "Komfort", base: 8000, perKm: 3000, emoji: "🚙" },
  biznes: { name: "Biznes", base: 15000, perKm: 4000, emoji: "🏎️" },
};

function taxiPrice(from, to, cls) {
  const c = TAXI_CLASSES[cls] || TAXI_CLASSES.ekoi;
  const km = 2 + ((from.length + to.length * 3) % 9);
  return { price: c.base + c.perKm * km, km };
}

app.get("/api/taxi/classes", (_req, res) =>
  res.json({ classes: Object.entries(TAXI_CLASSES).map(([key, c]) => ({ key, ...c })) })
);

app.post("/api/taxi/estimate", (req, res) => {
  const from = String(req.body.from || "").trim();
  const to = String(req.body.to || "").trim();
  if (!from || !to) return res.status(400).json({ error: "Qayerdan va Qayerga manzillarini kiriting" });
  const cls = String(req.body.car_class || "ekoi");
  const r = taxiPrice(from, to, cls);
  res.json({ ...r, class: TAXI_CLASSES[cls] ? cls : "ekoi" });
});

app.post("/api/taxi", auth, (req, res) => {
  const from = String(req.body.from || "").trim();
  const to = String(req.body.to || "").trim();
  const cls = TAXI_CLASSES[req.body.car_class] ? String(req.body.car_class) : "ekoi";
  if (!from || !to) return res.status(400).json({ error: "Qayerdan va Qayerga manzillarini kiriting" });
  const { price } = taxiPrice(from, to, cls);
  const drivers = ["Sardor A.", "Jasur T.", "Otabek M.", "Dilshod R.", "Aziz K."];
  const driver = drivers[Math.floor(Math.random() * drivers.length)];
  const info = db
    .prepare("INSERT INTO taxi_orders (user_id, from_addr, to_addr, car_class, price, status, driver) VALUES (?, ?, ?, ?, ?, 'yangi', ?)")
    .run(req.user.id, from, to, cls, price, driver);
  res.json({ ok: true, id: Number(info.lastInsertRowid), price, driver, class: TAXI_CLASSES[cls] });
});

app.get("/api/taxi", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM taxi_orders WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(req.user.id);
  res.json({ orders: rows.map((r) => ({ ...r, class: TAXI_CLASSES[r.car_class] })) });
});

app.post("/api/taxi/:id/cancel", auth, (req, res) => {
  const o = db.prepare("SELECT * FROM taxi_orders WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.user.id);
  if (!o) return res.status(404).json({ error: "Buyurtma topilmadi" });
  if (!["yangi", "keldi"].includes(o.status))
    return res.status(400).json({ error: "Haydachi allaqachon yo'lda — bekor qilib bo'lmaydi" });
  db.prepare("UPDATE taxi_orders SET status = 'bekor qilindi' WHERE id = ?").run(o.id);
  res.json({ ok: true });
});

// ---------- ADMIN ----------
app.get("/api/admin/overview", admin, (_req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    users: one("SELECT COUNT(*) c FROM users").c,
    orders: one("SELECT COUNT(*) c FROM orders WHERE status != 'bekor qilindi'").c,
    cancelled: one("SELECT COUNT(*) c FROM orders WHERE status = 'bekor qilindi'").c,
    revenue: one("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'bekor qilindi'").s,
    taxi: one("SELECT COUNT(*) c FROM taxi_orders WHERE status != 'bekor qilindi'").c,
    products: one("SELECT COUNT(*) c FROM products WHERE active=1").c,
    warehouses: one("SELECT COUNT(*) c FROM warehouses").c,
  });
});

app.get("/api/admin/warehouses", admin, (_req, res) =>
  res.json({
    warehouses: db
      .prepare(
        "SELECT w.*, COALESCE(SUM(s.qty),0) items FROM warehouses w LEFT JOIN stocks s ON s.warehouse_id=w.id GROUP BY w.id ORDER BY w.id"
      )
      .all(),
  })
);

app.post("/api/admin/warehouses", admin, (req, res) => {
  const name = String(req.body.name || "").trim();
  const address = String(req.body.address || "").trim();
  const city = String(req.body.city || "").trim() || "Toshkent";
  if (!name || !address) return res.status(400).json({ error: "Nom va manzilni kiriting" });
  const info = db.prepare("INSERT INTO warehouses (name, address, city) VALUES (?, ?, ?)").run(name, address, city);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.get("/api/admin/products", admin, (_req, res) =>
  res.json({
    products: db
      .prepare(
        `SELECT p.*, c.name AS category, COALESCE((SELECT SUM(qty) FROM stocks WHERE product_id=p.id),0) qty
         FROM products p JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC`
      )
      .all(),
    categories: db.prepare("SELECT * FROM categories ORDER BY sort").all(),
    warehouses: db.prepare("SELECT * FROM warehouses ORDER BY id").all(),
    stocks: db.prepare("SELECT * FROM stocks").all(),
  })
);

app.post("/api/admin/products", admin, (req, res) => {
  const category_id = Number(req.body.category_id);
  const name = String(req.body.name || "").trim();
  const price = Math.floor(Number(req.body.price));
  const emoji = String(req.body.emoji || "📦").trim() || "📦";
  const warehouse_id = Number(req.body.warehouse_id) || 0;
  const qty = Math.max(0, Math.floor(Number(req.body.qty) || 0));
  if (!category_id || !name || !(price > 0)) return res.status(400).json({ error: "Ma'lumotlarni to'ldiring" });
  const info = db.prepare("INSERT INTO products (category_id, name, price, emoji) VALUES (?, ?, ?, ?)").run(category_id, name, price, emoji);
  const pid = Number(info.lastInsertRowid);
  if (warehouse_id && qty > 0)
    db.prepare("INSERT INTO stocks (product_id, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = qty + excluded.qty").run(pid, warehouse_id, qty);
  res.json({ ok: true, id: pid });
});

app.put("/api/admin/products/:id/stock", admin, (req, res) => {
  const pid = Number(req.params.id);
  const warehouse_id = Number(req.body.warehouse_id);
  const qty = Math.max(0, Math.floor(Number(req.body.qty) || 0));
  if (!warehouse_id) return res.status(400).json({ error: "Omborni tanlang" });
  db.prepare(
    "INSERT INTO stocks (product_id, warehouse_id, qty) VALUES (?, ?, ?) ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty"
  ).run(pid, warehouse_id, qty);
  res.json({ ok: true });
});

app.put("/api/admin/products/:id", admin, (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: "Topilmadi" });
  const name = req.body.name !== undefined ? String(req.body.name).trim() || p.name : p.name;
  const price = req.body.price !== undefined ? Math.floor(Number(req.body.price)) || p.price : p.price;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : p.active;
  db.prepare("UPDATE products SET name=?, price=?, active=? WHERE id=?").run(name, price, active, p.id);
  res.json({ ok: true });
});

app.get("/api/admin/orders", admin, (_req, res) => {
  const rows = db
    .prepare("SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 200")
    .all();
  res.json({
    orders: rows.map((o) => ({ ...o, items: JSON.parse(o.items), warehouses: JSON.parse(o.warehouses) })),
    statuses: ORDER_STATUS,
  });
});

app.put("/api/admin/orders/:id/status", admin, (req, res) => {
  const status = String(req.body.status || "");
  if (!ORDER_STATUS.includes(status)) return res.status(400).json({ error: "Noto'g'ri holat" });
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Topilmadi" });
  if (status === "bekor qilindi" && o.type === "market") {
    for (const l of JSON.parse(o.items))
      for (const a of l.from || [])
        db.prepare("UPDATE stocks SET qty = qty + ? WHERE product_id = ? AND warehouse_id = ?").run(a.qty, l.id, a.warehouse_id);
  }
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, o.id);
  res.json({ ok: true });
});

app.get("/api/admin/taxi", admin, (_req, res) => {
  const rows = db
    .prepare("SELECT t.*, u.username FROM taxi_orders t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 200")
    .all();
  res.json({ orders: rows.map((r) => ({ ...r, class: TAXI_CLASSES[r.car_class] })), statuses: TAXI_STATUS });
});

app.put("/api/admin/taxi/:id/status", admin, (req, res) => {
  const status = String(req.body.status || "");
  if (!TAXI_STATUS.includes(status)) return res.status(400).json({ error: "Noto'g'ri holat" });
  const r = db.prepare("UPDATE taxi_orders SET status = ? WHERE id = ?").run(status, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: "Topilmadi" });
  res.json({ ok: true });
});

// ---------- ADMIN: FOYDALANUVCHILAR ----------
app.get("/api/admin/users", admin, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const sql = `SELECT u.id, u.username, u.google_email, u.is_admin, u.banned, u.created_at,
    (SELECT COUNT(*) FROM orders WHERE user_id = u.id) orders
    FROM users u {WHERE} ORDER BY u.id DESC LIMIT 200`;
  const rows = q
    ? db.prepare(sql.replace("{WHERE}", "WHERE u.username LIKE ? OR u.google_email LIKE ?")).all(`%${q}%`, `%${q}%`)
    : db.prepare(sql.replace("{WHERE}", "")).all();
  res.json({ users: rows });
});

app.put("/api/admin/users/:id", admin, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(req.params.id));
  if (!u) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
  if (u.id === req.user.id && req.body.is_admin === false)
    return res.status(400).json({ error: "O'zingizni adminlikdan ololmaysiz" });
  const banned = req.body.banned !== undefined ? (req.body.banned ? 1 : 0) : u.banned;
  const is_admin = req.body.is_admin !== undefined ? (req.body.is_admin ? 1 : 0) : u.is_admin;
  db.prepare("UPDATE users SET banned = ?, is_admin = ? WHERE id = ?").run(banned, is_admin, u.id);
  res.json({ ok: true });
});

// ---------- ADMIN: KATEGORIYALAR ----------
app.post("/api/admin/categories", admin, (req, res) => {
  const name = String(req.body.name || "").trim();
  const emoji = String(req.body.emoji || "🛒").trim() || "🛒";
  if (!name) return res.status(400).json({ error: "Kategoriya nomini kiriting" });
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort),0) m FROM categories").get().m;
  const info = db.prepare("INSERT INTO categories (name, emoji, sort) VALUES (?, ?, ?)").run(name, emoji, maxSort + 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.put("/api/admin/categories/:id", admin, (req, res) => {
  const c = db.prepare("SELECT * FROM categories WHERE id = ?").get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: "Topilmadi" });
  const name = req.body.name !== undefined ? String(req.body.name).trim() || c.name : c.name;
  const emoji = req.body.emoji !== undefined ? String(req.body.emoji).trim() || c.emoji : c.emoji;
  db.prepare("UPDATE categories SET name = ?, emoji = ? WHERE id = ?").run(name, emoji, c.id);
  res.json({ ok: true });
});

app.delete("/api/admin/categories/:id", admin, (req, res) => {
  const id = Number(req.params.id);
  const count = db.prepare("SELECT COUNT(*) c FROM products WHERE category_id = ?").get(id).c;
  if (count) return res.status(400).json({ error: `Bu kategoriyada ${count} ta tovar bor — avval tovarlarni o'chiring` });
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------- ADMIN: TAOMLAR ----------
app.post("/api/admin/food-places", admin, (req, res) => {
  const name = String(req.body.name || "").trim();
  const emoji = String(req.body.emoji || "🍽️").trim() || "🍽️";
  const rating = Math.min(5, Math.max(1, Number(req.body.rating) || 4.5));
  const delivery_min = Math.max(5, Math.floor(Number(req.body.delivery_min) || 30));
  if (!name) return res.status(400).json({ error: "Restoran nomini kiriting" });
  const info = db.prepare("INSERT INTO food_places (name, emoji, rating, delivery_min) VALUES (?, ?, ?, ?)").run(name, emoji, rating, delivery_min);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.delete("/api/admin/food-places/:id", admin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM food_items WHERE place_id = ?").run(id);
  db.prepare("DELETE FROM food_places WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.post("/api/admin/food-items", admin, (req, res) => {
  const place_id = Number(req.body.place_id);
  const name = String(req.body.name || "").trim();
  const price = Math.floor(Number(req.body.price));
  const emoji = String(req.body.emoji || "🍽️").trim() || "🍽️";
  if (!place_id || !name || !(price > 0)) return res.status(400).json({ error: "Ma'lumotlarni to'ldiring" });
  const info = db.prepare("INSERT INTO food_items (place_id, name, price, emoji) VALUES (?, ?, ?, ?)").run(place_id, name, price, emoji);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

app.put("/api/admin/food-items/:id", admin, (req, res) => {
  const f = db.prepare("SELECT * FROM food_items WHERE id = ?").get(Number(req.params.id));
  if (!f) return res.status(404).json({ error: "Topilmadi" });
  const name = req.body.name !== undefined ? String(req.body.name).trim() || f.name : f.name;
  const price = req.body.price !== undefined ? Math.floor(Number(req.body.price)) || f.price : f.price;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : f.active;
  db.prepare("UPDATE food_items SET name = ?, price = ?, active = ? WHERE id = ?").run(name, price, active, f.id);
  res.json({ ok: true });
});

app.delete("/api/admin/food-items/:id", admin, (req, res) => {
  db.prepare("DELETE FROM food_items WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`[market] http://localhost:${PORT} (admin: /admin)`));
