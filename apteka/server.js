const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { db, getSetting, setSetting, nextNo, lowStock, DOC_TYPES, bcode } = require("./db");

const app = express();
const PORT = process.env.APTEKA_PORT || 4000;
const SESS = new Map();

const UP_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, UP_DIR),
    filename: (req, f, cb) => cb(null, Date.now() + "-" + crypto.randomBytes(4).toString("hex") + (path.extname(f.originalname || ".jpg") || ".jpg").toLowerCase())
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype))
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UP_DIR));

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
const auth = (req, res, next) => {
  const u = SESS.get((req.headers.authorization || "").replace("Bearer ", "").trim());
  if (!u) return res.status(401).json({ error: "Kiring" });
  req.user = u;
  next();
};
const n = (v) => Math.max(0, Math.round(Number(v) || 0));
const one = (q, ...p) => Object.values(db.prepare(q).get(...p))[0] || 0;

app.post("/api/login", wrap((req, res) => {
  const { login, pass } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE login=?").get(String(login || ""));
  if (!u || u.pass !== String(pass || "")) throw new Error("Login yoki parol xato");
  const t = crypto.randomBytes(16).toString("hex");
  SESS.set(t, u);
  res.json({ token: t, user: { id: u.id, name: u.name, login: u.login, role: u.role } });
}));

app.get("/api/me", auth, (req, res) => res.json({ id: req.user.id, name: req.user.name, role: req.user.role }));

app.get("/api/meta", auth, wrap((req, res) =>
  res.json({ doc_types: DOC_TYPES, low: lowStock(), unit: getSetting("unit_label", "dona") })
));

/* ---------------- Nomenklatura ---------------- */
app.get("/api/items", auth, wrap((req, res) => {
  const q = String(req.query.q || "").trim();
  const cat = String(req.query.cat || "").trim();
  let sql = `SELECT i.*, sp.name supplier, IFNULL(SUM(s.qty),0) total,
                    COUNT(s.id) positions
             FROM items i LEFT JOIN stocks s ON s.item_id = i.id
             LEFT JOIN suppliers sp ON sp.id = i.supplier_id`;
  const w = ["i.active = 1"];
  const p = [];
  if (q) {
    w.push("(i.name LIKE ? OR i.sku LIKE ? OR i.barcode LIKE ? OR i.category LIKE ?)");
    p.push("%" + q + "%", "%" + q + "%", "%" + q + "%", "%" + q + "%");
  }
  if (cat) {
    w.push("i.category = ?");
    p.push(cat);
  }
  sql += " WHERE " + w.join(" AND ") + " GROUP BY i.id ORDER BY i.name";
  const items = db.prepare(sql).all(...p);
  const cats = db.prepare("SELECT DISTINCT category FROM items WHERE active=1 ORDER BY category").all().map((r) => r.category);
  res.json({ items, cats });
}));

app.post("/api/items", auth, wrap((req, res) => {
  const b = req.body || {};
  if (!b.name) throw new Error("Nomi kiritilishi shart");
  if (!n(b.min_stock) && !Number(b.min_stock)) throw new Error("Minimal zaxira kiritilishi shart");
  let sku = String(b.sku || "").trim();
  if (!sku) {
    let i = db.prepare("SELECT COUNT(*) c FROM items").get().c + 1;
    sku = "MD" + String(100000 + i * 13);
    while (db.prepare("SELECT 1 FROM items WHERE sku=?").get(sku)) sku = "MD" + String(100000 + ++i * 13);
  }
  const r = db
    .prepare(
      `INSERT INTO items (sku,barcode,name,form,category,unit,cost,min_stock,max_stock,supplier_id,note,image)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(sku, String(b.barcode || bcode(one("SELECT COUNT(*) c FROM items") + 1)), String(b.name).trim(), b.form || "tabletka",
      b.category || "boshqa", b.unit || "dona", n(b.cost), n(b.min_stock), n(b.max_stock) || 100,
      b.supplier_id ? Number(b.supplier_id) : null, b.note || "", String(b.image || ""));
  res.json({ ok: true, id: Number(r.lastInsertRowid), sku });
}));

app.put("/api/items/:id", auth, wrap((req, res) => {
  const b = req.body || {};
  const it = db.prepare("SELECT * FROM items WHERE id=?").get(Number(req.params.id));
  if (!it) throw new Error("Tovar topilmadi");
  db.prepare(
    "UPDATE items SET name=?,form=?,category=?,unit=?,cost=?,min_stock=?,max_stock=?,supplier_id=?,note=?,image=?,active=? WHERE id=?"
  ).run(b.name ?? it.name, b.form ?? it.form, b.category ?? it.category, b.unit ?? it.unit,
    b.cost === undefined ? it.cost : n(b.cost), b.min_stock === undefined ? it.min_stock : n(b.min_stock),
    b.max_stock === undefined ? it.max_stock : n(b.max_stock), b.supplier_id ?? it.supplier_id,
    b.note ?? it.note, b.image ?? it.image, b.active === 0 ? 0 : 1, it.id);
  res.json({ ok: true });
}));

app.delete("/api/items/:id", auth, wrap((req, res) => {
  const used = one("SELECT COUNT(*) c FROM stocks WHERE item_id=? AND qty>0", Number(req.params.id));
  if (used) throw new Error(`Omborda ${used} ta pozitsiyada qoldi — avval chiqim qiling`);
  db.prepare("UPDATE items SET active=0 WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
}));

app.post("/api/upload", auth, upload.single("image"), wrap((req, res) => {
  if (!req.file) throw new Error("Rasm fayli tanlanmagan (faqat rasm, 4 MB gacha)");
  res.json({ ok: true, url: "/uploads/" + req.file.filename });
}));
app.post("/api/items/:id/image", auth, upload.single("image"), wrap((req, res) => {
  if (!req.file) throw new Error("Rasm fayli tanlanmagan");
  const url = "/uploads/" + req.file.filename;
  const r = db.prepare("UPDATE items SET image=? WHERE id=?").run(url, Number(req.params.id));
  if (!r.changes) throw new Error("Tovar topilmadi");
  res.json({ ok: true, image: url });
}));

/* ---------------- Stelyaj / joylar ---------------- */
function buildLocation(l) {
  const stocks = db
    .prepare(
      `SELECT s.*, (s.cell_row || '-' || s.cell_col) cell, i.name item_name, i.unit, i.barcode, i.sku item_sku, i.image, i.min_stock, i.cost
       FROM stocks s JOIN items i ON i.id = s.item_id
       WHERE s.location_id = ? ORDER BY s.cell_row, s.cell_col`
    )
    .all(l.id);
  const cells = [];
  if (l.kind === "stelyaj") {
    for (let r = 1; r <= l.rows; r++)
      for (let c = 1; c <= l.cols; c++) {
        const inCell = stocks.filter((s) => s.cell_row === r && s.cell_col === c);
        const q = inCell.reduce((a, s) => a + s.qty, 0);
        const st = q <= 0 ? "bosh" : q <= 5 ? "kam" : q >= l.cell_cap ? "to'liq" : "normal";
        cells.push({ row: r, col: c, name: `${r}-${c}`, qty: q, cap: l.cell_cap, state: st, stocks: inCell });
      }
  } else {
    const q = stocks.reduce((a, s) => a + s.qty, 0);
    cells.push({ row: 1, col: 1, name: "butun", qty: q, cap: l.cell_cap, state: q ? "normal" : "bosh", stocks });
  }
  return {
    ...l,
    cells,
    positions: stocks.length,
    total_qty: stocks.reduce((a, s) => a + s.qty, 0),
    used_cells: cells.filter((c) => c.qty > 0).length,
    total_cells: l.kind === "stelyaj" ? l.rows * l.cols : 1
  };
}

app.get("/api/locations", auth, wrap((req, res) =>
  res.json(db.prepare("SELECT * FROM locations WHERE active=1 ORDER BY floor, zone, code").all().map(buildLocation))
));

app.post("/api/locations", auth, wrap((req, res) => {
  const b = req.body || {};
  const code = String(b.code || "").trim().toUpperCase();
  if (!code) throw new Error("Kod kiritilishi shart (masalan E-1)");
  if (db.prepare("SELECT 1 FROM locations WHERE code=?").get(code)) throw new Error("Bunday kod allaqachon bor");
  const kind = b.kind === "zona" ? "zona" : "stelyaj";
  const r = db
    .prepare("INSERT INTO locations (code,zone,name,kind,rows,cols,cell_cap,note,building,room,floor) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(code, String(b.zone || code.split("-")[0]).toUpperCase(), b.name || "", kind,
      kind === "zona" ? 1 : Math.min(12, Math.max(1, n(b.rows) || 4)),
      kind === "zona" ? 1 : Math.min(12, Math.max(1, n(b.cols) || 6)),
      Math.max(1, n(b.cell_cap) || 60), b.note || "",
      String(b.building || "Bino-1"), String(b.room || "Xona-1"), Math.max(1, n(b.floor) || 1));
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));

app.put("/api/locations/:id", auth, wrap((req, res) => {
  const b = req.body || {};
  const l = db.prepare("SELECT * FROM locations WHERE id=?").get(Number(req.params.id));
  if (!l) throw new Error("Joy topilmadi");
  const rows = l.kind === "zona" ? 1 : Math.min(12, Math.max(1, n(b.rows) || l.rows));
  const cols = l.kind === "zona" ? 1 : Math.min(12, Math.max(1, n(b.cols) || l.cols));
  const bad = db.prepare("SELECT * FROM stocks WHERE location_id=? AND (cell_row>? OR cell_col>?)").all(l.id, rows, cols).find((s) => s.qty > 0);
  if (bad) throw new Error(`${bad.cell_row}-${bad.cell_col} katakdagi tovar tashqarida qoladi`);
  db.prepare("UPDATE locations SET name=?,rows=?,cols=?,cell_cap=?,note=?,building=?,room=?,floor=? WHERE id=?").run(
    b.name ?? l.name, rows, cols, Math.max(1, n(b.cell_cap) || l.cell_cap), b.note ?? l.note,
    String(b.building ?? l.building), String(b.room ?? l.room), Math.max(1, n(b.floor) || l.floor), l.id);
  res.json({ ok: true });
}));

app.delete("/api/locations/:id", auth, wrap((req, res) => {
  const q = one("SELECT COUNT(*) c FROM stocks WHERE location_id=? AND qty>0", Number(req.params.id));
  if (q) throw new Error(`Bu joyda ${q} ta tovar bor — avval ko'chiring yoki chiqim qiling`);
  db.prepare("UPDATE locations SET active=0 WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
}));

app.get("/api/map", auth, wrap((req, res) => {
  const locs = db.prepare("SELECT * FROM locations WHERE active=1 ORDER BY floor, zone, code").all().map(buildLocation);
  res.json({
    zones: [...new Set(locs.map((l) => l.zone))],
    locations: locs,
    total_qty: locs.reduce((a, l) => a + l.total_qty, 0),
    positions: locs.reduce((a, l) => a + l.positions, 0),
    alerts: locs.flatMap((l) => l.cells.filter((c) => c.state !== "normal" && c.state !== "bosh").map((c) => ({ loc: l.code, cell: c.name, state: c.state, qty: c.qty })))
  });
}));

/* ---------------- Pozitsiyalar (SKU) ---------------- */
const STOCK_SQL = `SELECT s.*, (s.cell_row || '-' || s.cell_col) cell, i.name item_name, i.unit, i.sku item_sku, i.barcode, i.image, i.min_stock,
                          l.code loc_code, l.zone, l.kind loc_kind
                   FROM stocks s JOIN items i ON i.id = s.item_id JOIN locations l ON l.id = s.location_id`;

app.get("/api/stocks", auth, wrap((req, res) => {
  const q = String(req.query.q || "").trim();
  const loc = String(req.query.loc || "").trim();
  const only = String(req.query.only || "");
  let sql = STOCK_SQL;
  const w = [];
  const p = [];
  if (q) {
    w.push("(i.name LIKE ? OR i.barcode LIKE ? OR i.sku LIKE ? OR s.code LIKE ? OR l.code LIKE ? OR s.batch_no LIKE ?)");
    p.push("%" + q + "%", "%" + q + "%", "%" + q + "%", "%" + q + "%", "%" + q + "%", "%" + q + "%");
  }
  if (loc) {
    w.push("l.code = ?");
    p.push(loc);
  }
  if (only === "low") w.push("s.qty <= s.min_qty");
  if (only === "exp") w.push("s.expiry <> '' AND date(s.expiry) <= date('now','+90 day')");
  if (w.length) sql += " WHERE " + w.join(" AND ");
  sql += " ORDER BY l.zone, l.code, s.cell_row, s.cell_col";
  res.json(db.prepare(sql).all(...p).map((s) => ({ ...s, cell: `${s.cell_row}-${s.cell_col}` })));
}));

app.get("/api/stocks/:id", auth, wrap((req, res) => {
  const s = db.prepare(STOCK_SQL + " WHERE s.id=?").get(Number(req.params.id));
  if (!s) throw new Error("Pozitsiya topilmadi");
  res.json({ ...s, cell: `${s.cell_row}-${s.cell_col}` });
}));

function findStock(item_id, loc_id, row, col) {
  return db
    .prepare("SELECT * FROM stocks WHERE item_id=? AND location_id=? AND cell_row=? AND cell_col=?")
    .get(item_id, loc_id, row, col);
}

function capCheck(loc_id, row, col, add, exceptId) {
  const l = db.prepare("SELECT * FROM locations WHERE id=?").get(loc_id);
  if (!l) throw new Error("Joy topilmadi");
  if (l.kind === "stelyaj" && (row < 1 || row > l.rows || col < 1 || col > l.cols))
    throw new Error(`${l.code}: bu katak yo'q (1-${l.rows} qator, 1-${l.cols} ustun)`);
  const inCell = one(
    "SELECT IFNULL(SUM(qty),0) c FROM stocks WHERE location_id=? AND cell_row=? AND cell_col=? AND id<>?",
    loc_id, row, col, exceptId || 0
  );
  if (inCell + add > l.cell_cap)
    throw new Error(`${l.code} ${row}-${col} katak sig'imi ${l.cell_cap} (hozir ${inCell}, qo'shilayotgan ${add})`);
}

function newCode(loc, row, col) {
  const base = `PK-${String(row).padStart(2, "0")}${String(col).padStart(2, "0")}-`;
  let k = db.prepare("SELECT COUNT(*) c FROM stocks WHERE code LIKE ?").get(base + "%").c + 1;
  let code = base + loc.code.replace("-", "") + "-" + String(k).padStart(3, "0");
  while (db.prepare("SELECT 1 FROM stocks WHERE code=?").get(code)) code = base + loc.code.replace("-", "") + "-" + String(++k).padStart(3, "0");
  return code;
}

/* ---------------- Hujjatlar ---------------- */
function docFull(id) {
  const d = db.prepare("SELECT d.*, sp.name supplier FROM docs d LEFT JOIN suppliers sp ON sp.id=d.supplier_id WHERE d.id=?").get(Number(id));
  if (!d) return null;
  const lines = db
    .prepare(
      `SELECT dl.*, i.name item_name, i.unit, i.sku item_sku, i.barcode, i.cost, l.code loc_code, l2.code to_loc_code
       FROM doc_lines dl JOIN items i ON i.id=dl.item_id
       LEFT JOIN locations l ON l.id=dl.location_id
       LEFT JOIN locations l2 ON l2.id=dl.to_location_id
       WHERE dl.doc_id=? ORDER BY dl.id`
    )
    .all(d.id)
    .map((l) => ({ ...l, sum: n(l.qty) * n(l.cost) }));
  return { ...d, lines, total_sum: lines.reduce((a, l) => a + l.sum, 0), type_name: DOC_TYPES[d.type] || d.type };
}

app.get("/api/docs", auth, wrap((req, res) => {
  const type = String(req.query.type || "");
  const status = String(req.query.status || "");
  let sql = `SELECT d.*, sp.name supplier,
                    (SELECT COUNT(*) FROM doc_lines dl WHERE dl.doc_id=d.id) lines_count
             FROM docs d LEFT JOIN suppliers sp ON sp.id=d.supplier_id`;
  const w = [];
  const p = [];
  if (type) {
    w.push("d.type=?");
    p.push(type);
  }
  if (status) {
    w.push("d.status=?");
    p.push(status);
  }
  if (w.length) sql += " WHERE " + w.join(" AND ");
  sql += " ORDER BY d.id DESC LIMIT 300";
  res.json(db.prepare(sql).all(...p));
}));

app.get("/api/docs/:id", wrap((req, res) => {
  const d = docFull(req.params.id);
  if (!d) throw new Error("Hujjat topilmadi");
  res.json(d);
}));

app.get("/api/docs/next/:type", auth, wrap((req, res) => {
  const pref = { kirish: "KR", chiqim: "CH", "ko'chirish": "KC", "yo'qotish": "YQ", inventarizatsiya: "IN" }[req.params.type] || "XX";
  res.json({ no: nextNo(pref, "docs") });
}));

app.post("/api/docs", auth, wrap((req, res) => {
  const b = req.body || {};
  const type = String(b.type || "");
  if (!DOC_TYPES[type]) throw new Error("Hujjat turi noto'g'ri");
  const lines = Array.isArray(b.lines) ? b.lines.filter((l) => n(l.qty) > 0) : [];
  if (!lines.length) throw new Error("Kamida bitta qator kiriting");
  const no = nextNo({ kirish: "KR", chiqim: "CH", "ko'chirish": "KC", "yo'qotish": "YQ", inventarizatsiya: "IN" }[type], "docs");
  const d = db
    .prepare("INSERT INTO docs (no,type,status,supplier_id,dest,doc_date,note,lines_count,total_qty,user) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(no, type, "draft", b.supplier_id ? Number(b.supplier_id) : null, b.dest || "", b.doc_date || new Date().toISOString().slice(0, 10),
      b.note || "", lines.length, lines.reduce((a, l) => a + n(l.qty), 0), req.user.name);
  const id = Number(d.lastInsertRowid);
  const ins = db.prepare(
    `INSERT INTO doc_lines (doc_id,stock_id,item_id,location_id,cell_row,cell_col,to_location_id,to_cell_row,to_cell_col,qty,batch_no,expiry,note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const l of lines) {
    if (!l.item_id) throw new Error("Tovar tanlanmagan");
    ins.run(id, l.stock_id ? Number(l.stock_id) : null, Number(l.item_id),
      l.location_id ? Number(l.location_id) : null, n(l.cell_row) || 1, n(l.cell_col) || 1,
      l.to_location_id ? Number(l.to_location_id) : null, n(l.to_cell_row) || 1, n(l.to_cell_col) || 1,
      n(l.qty), l.batch_no || "", l.expiry || "", l.note || "");
  }
  res.json({ ok: true, id, no });
}));

function move(doc_id, doc_no, doc_type, stock_id, item_id, loc_id, to_loc_id, qty, dir, user, note) {
  const bal = one("SELECT qty FROM stocks WHERE id=?", stock_id);
  db.prepare(
    "INSERT INTO movements (doc_id,doc_no,doc_type,stock_id,item_id,location_id,to_location_id,qty,direction,balance_after,user,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(doc_id, doc_no, doc_type, stock_id, item_id, loc_id, to_loc_id, qty, dir, bal, user, note || "");
}

app.post("/api/docs/:id/confirm", auth, wrap((req, res) => {
  const d = db.prepare("SELECT * FROM docs WHERE id=?").get(Number(req.params.id));
  if (!d) throw new Error("Hujjat topilmadi");
  if (d.status === "tasdiqlandi") throw new Error("Hujjat allaqachon tasdiqlangan");
  const lines = db.prepare("SELECT * FROM doc_lines WHERE doc_id=?").all(d.id);
  for (const l of lines) {
    const qty = n(l.qty);
    if (d.type === "kirish" || d.type === "inventarizatsiya") {
      if (!l.location_id) throw new Error("Joy tanlanmagan");
      if (d.type === "kirish") capCheck(l.location_id, l.cell_row, l.cell_col, qty, 0);
      let s = l.stock_id ? db.prepare("SELECT * FROM stocks WHERE id=?").get(l.stock_id) : null;
      if (!s) s = findStock(l.item_id, l.location_id, l.cell_row, l.cell_col);
      if (s) {
        db.prepare("UPDATE stocks SET qty=qty+?, batch_no=COALESCE(NULLIF(?,''),batch_no), expiry=COALESCE(NULLIF(?,''),expiry) WHERE id=?").run(qty, l.batch_no, l.expiry, s.id);
        move(d.id, d.no, d.type, s.id, l.item_id, s.location_id, null, qty, "in", req.user.name, l.note);
      } else {
        const loc = db.prepare("SELECT * FROM locations WHERE id=?").get(l.location_id);
        const r = db.prepare("INSERT INTO stocks (code,item_id,location_id,cell_row,cell_col,batch_no,expiry,qty,min_qty) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(newCode(loc, l.cell_row, l.cell_col), l.item_id, l.location_id, l.cell_row, l.cell_col, l.batch_no, l.expiry, qty, 5);
        move(d.id, d.no, d.type, Number(r.lastInsertRowid), l.item_id, l.location_id, null, qty, "in", req.user.name, l.note);
      }
    } else if (d.type === "ko'chirish") {
      if (!l.stock_id || !l.to_location_id) throw new Error("Ko'chirish uchun manba va manzil kerak");
      const s = db.prepare("SELECT * FROM stocks WHERE id=?").get(l.stock_id);
      if (!s) throw new Error("Manba pozitsiya topilmadi");
      if (s.qty < qty) throw new Error(`Manbada faqat ${s.qty} dona bor`);
      capCheck(l.to_location_id, l.to_cell_row, l.to_cell_col, qty, 0);
      db.prepare("UPDATE stocks SET qty=qty-? WHERE id=?").run(qty, s.id);
      move(d.id, d.no, d.type, s.id, l.item_id, s.location_id, l.to_location_id, qty, "out", req.user.name, l.note);
      let t = findStock(l.item_id, l.to_location_id, l.to_cell_row, l.to_cell_col);
      if (t) {
        db.prepare("UPDATE stocks SET qty=qty+? WHERE id=?").run(qty, t.id);
        move(d.id, d.no, d.type, t.id, l.item_id, l.to_location_id, null, qty, "in", req.user.name, l.note);
      } else {
        const loc = db.prepare("SELECT * FROM locations WHERE id=?").get(l.to_location_id);
        const r = db.prepare("INSERT INTO stocks (code,item_id,location_id,cell_row,cell_col,batch_no,expiry,qty,min_qty) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(newCode(loc, l.to_cell_row, l.to_cell_col), l.item_id, l.to_location_id, l.to_cell_row, l.to_cell_col, s.batch_no, s.expiry, qty, 5);
        move(d.id, d.no, d.type, Number(r.lastInsertRowid), l.item_id, l.to_location_id, null, qty, "in", req.user.name, l.note);
      }
    } else {
      if (!l.stock_id) throw new Error("Pozitsiya tanlanmagan");
      const s = db.prepare("SELECT * FROM stocks WHERE id=?").get(l.stock_id);
      if (!s) throw new Error("Pozitsiya topilmadi");
      if (s.qty < qty) throw new Error(`"${s.item_name || ""}" da faqat ${s.qty} dona bor`);
      db.prepare("UPDATE stocks SET qty=qty-? WHERE id=?").run(qty, s.id);
      move(d.id, d.no, d.type, s.id, l.item_id, s.location_id, null, qty, "out", req.user.name, d.type === "yo'qotish" ? d.note || "yo'qotish" : l.note);
    }
  }
  db.prepare("UPDATE docs SET status='tasdiqlandi', confirmed_at=datetime('now') WHERE id=?").run(d.id);
  res.json({ ok: true, no: d.no, lines: lines.length });
}));

app.post("/api/docs/:id/cancel", auth, wrap((req, res) => {
  const d = db.prepare("SELECT * FROM docs WHERE id=?").get(Number(req.params.id));
  if (!d) throw new Error("Hujjat topilmadi");
  if (d.status === "bekor qilindi") throw new Error("Hujjat allaqachon bekor qilingan");
  if (d.status === "tasdiqlandi") {
    const lines = db.prepare("SELECT * FROM doc_lines WHERE doc_id=? ORDER BY id DESC").all(d.id);
    for (const l of lines) {
      if (d.type === "ko'chirish") {
        const t = findStock(l.item_id, l.to_location_id, l.to_cell_row, l.to_cell_col);
        if (t) db.prepare("UPDATE stocks SET qty=MAX(0,qty-?) WHERE id=?").run(n(l.qty), t.id);
        const s = db.prepare("SELECT * FROM stocks WHERE id=?").get(l.stock_id);
        if (s) db.prepare("UPDATE stocks SET qty=qty+? WHERE id=?").run(n(l.qty), s.id);
      } else if (d.type === "kirish" || d.type === "inventarizatsiya") {
        const s = findStock(l.item_id, l.location_id, l.cell_row, l.cell_col);
        if (s) db.prepare("UPDATE stocks SET qty=MAX(0,qty-?) WHERE id=?").run(n(l.qty), s.id);
      } else {
        const s = db.prepare("SELECT * FROM stocks WHERE id=?").get(l.stock_id);
        if (s) db.prepare("UPDATE stocks SET qty=qty+? WHERE id=?").run(n(l.qty), s.id);
      }
      move(d.id, d.no, "bekor", l.stock_id, l.item_id, l.location_id, l.to_location_id, n(l.qty), d.type === "kirish" ? "out" : "in", req.user.name, "hujjat bekor qilindi");
    }
  }
  db.prepare("UPDATE docs SET status='bekor qilindi' WHERE id=?").run(d.id);
  res.json({ ok: true });
}));

app.delete("/api/docs/:id", auth, wrap((req, res) => {
  const d = db.prepare("SELECT * FROM docs WHERE id=?").get(Number(req.params.id));
  if (!d) throw new Error("Hujjat topilmadi");
  if (d.status !== "draft") throw new Error("Faqat qoralama (draft) hujjatni o'chirish mumkin");
  db.prepare("DELETE FROM doc_lines WHERE doc_id=?").run(d.id);
  db.prepare("DELETE FROM docs WHERE id=?").run(d.id);
  res.json({ ok: true });
}));

/* ---------------- Harakatlar ---------------- */
app.get("/api/movements", auth, wrap((req, res) => {
  const type = String(req.query.type || "");
  const q = String(req.query.q || "").trim();
  let sql = `SELECT m.*, i.name item_name, i.unit, l.code loc_code, l2.code to_loc_code
             FROM movements m JOIN items i ON i.id=m.item_id
             LEFT JOIN locations l ON l.id=m.location_id
             LEFT JOIN locations l2 ON l2.id=m.to_location_id`;
  const w = [];
  const p = [];
  if (type) {
    w.push("m.doc_type=?");
    p.push(type);
  }
  if (q) {
    w.push("(i.name LIKE ? OR m.doc_no LIKE ? OR l.code LIKE ?)");
    p.push("%" + q + "%", "%" + q + "%", "%" + q + "%");
  }
  if (w.length) sql += " WHERE " + w.join(" AND ");
  sql += " ORDER BY m.id DESC LIMIT 400";
  res.json(db.prepare(sql).all(...p));
}));

/* ---------------- Inventarizatsiya ---------------- */
app.get("/api/counts", auth, wrap((req, res) =>
  res.json(db.prepare(
    `SELECT c.*, l.code loc_code,
            (SELECT COUNT(*) FROM count_lines cl WHERE cl.count_id=c.id) lines,
            (SELECT COUNT(*) FROM count_lines cl WHERE cl.count_id=c.id AND cl.counted=1) counted
     FROM counts c LEFT JOIN locations l ON l.id=c.location_id ORDER BY c.id DESC`
  ).all())
));

app.post("/api/counts", auth, wrap((req, res) => {
  const b = req.body || {};
  const loc = b.location_id ? Number(b.location_id) : null;
  const stocks = loc
    ? db.prepare(STOCK_SQL + " WHERE s.location_id=? ORDER BY s.cell_row, s.cell_col").all(loc)
    : db.prepare(STOCK_SQL + " ORDER BY l.zone, l.code, s.cell_row, s.cell_col").all();
  if (!stocks.length) throw new Error("Hisobga olinadigan tovar yo'q");
  const c = db.prepare("INSERT INTO counts (no,location_id,status,doc_date,user,note) VALUES (?,?,?,?,?,?)")
    .run(nextNo("INV", "counts"), loc, "ochilgan", b.doc_date || new Date().toISOString().slice(0, 10), req.user.name, b.note || "");
  const id = Number(c.lastInsertRowid);
  const ins = db.prepare("INSERT INTO count_lines (count_id,stock_id,item_id,location_id,cell_row,cell_col,system_qty) VALUES (?,?,?,?,?,?,?)");
  for (const s of stocks) ins.run(id, s.id, s.item_id, s.location_id, s.cell_row, s.cell_col, s.qty);
  res.json({ ok: true, id, lines: stocks.length, no: db.prepare("SELECT no FROM counts WHERE id=?").get(id).no });
}));

app.get("/api/counts/:id", auth, wrap((req, res) => {
  const c = db.prepare("SELECT c.*, l.code loc_code FROM counts c LEFT JOIN locations l ON l.id=c.location_id WHERE c.id=?").get(Number(req.params.id));
  if (!c) throw new Error("Sessiya topilmadi");
  const lines = db
    .prepare(
      `SELECT cl.*, i.name item_name, i.unit, i.barcode, l.code loc_code
       FROM count_lines cl JOIN items i ON i.id=cl.item_id JOIN locations l ON l.id=cl.location_id
       WHERE cl.count_id=? ORDER BY l.zone, l.code, cl.cell_row, cl.cell_col`
    )
    .all(c.id)
    .map((x) => ({ ...x, cell: `${x.cell_row}-${x.cell_col}`, diff: x.actual_qty === null ? null : x.actual_qty - x.system_qty }));
  res.json({ ...c, lines, counted: lines.filter((l) => l.counted).length });
}));

app.put("/api/counts/:id/lines/:lid", auth, wrap((req, res) => {
  const c = db.prepare("SELECT * FROM counts WHERE id=?").get(Number(req.params.id));
  if (!c) throw new Error("Sessiya topilmadi");
  if (c.status !== "ochilgan") throw new Error("Sessiya yopilgan");
  const v = req.body?.actual_qty;
  if (v === "" || v === null || v === undefined) {
    db.prepare("UPDATE count_lines SET actual_qty=NULL, counted=0 WHERE id=? AND count_id=?").run(Number(req.params.lid), c.id);
  } else {
    db.prepare("UPDATE count_lines SET actual_qty=?, counted=1 WHERE id=? AND count_id=?").run(n(v), Number(req.params.lid), c.id);
  }
  res.json({ ok: true });
}));

app.post("/api/counts/:id/close", auth, wrap((req, res) => {
  const c = db.prepare("SELECT * FROM counts WHERE id=?").get(Number(req.params.id));
  if (!c) throw new Error("Sessiya topilmadi");
  if (c.status !== "ochilgan") throw new Error("Sessiya allaqachon yopilgan");
  const lines = db.prepare("SELECT * FROM count_lines WHERE count_id=? AND counted=1").all(c.id);
  if (!lines.length) throw new Error("Hech bir qator sanab o'tilmagan");
  const diffs = lines.filter((l) => l.actual_qty !== l.system_qty);
  let doc = null;
  if (diffs.length) {
    const no = nextNo("IN", "docs");
    const d = db
      .prepare("INSERT INTO docs (no,type,status,supplier_id,dest,doc_date,note,lines_count,total_qty,user,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))")
      .run(no, "inventarizatsiya", "tasdiqlandi", null, c.location_id ? "" : "butun ombor", new Date().toISOString().slice(0, 10),
        `${c.no} — inventarizatsiya farqi`, diffs.length, diffs.reduce((a, l) => a + Math.abs(l.actual_qty - l.system_qty), 0), req.user.name);
    const docId = Number(d.lastInsertRowid);
    const ins = db.prepare(
      "INSERT INTO doc_lines (doc_id,stock_id,item_id,location_id,cell_row,cell_col,qty,note) VALUES (?,?,?,?,?,?,?,?)"
    );
    for (const l of diffs) {
      const diff = l.actual_qty - l.system_qty;
      ins.run(docId, l.stock_id, l.item_id, l.location_id, l.cell_row, l.cell_col, Math.abs(diff), diff > 0 ? `+${diff} (ortiqcha topildi)` : `${diff} (kamlik)`);
      const s = db.prepare("SELECT * FROM stocks WHERE id=?").get(l.stock_id);
      const bal = s.qty + diff;
      db.prepare("UPDATE stocks SET qty=? WHERE id=?").run(bal, l.stock_id);
      move(docId, no, "inventarizatsiya", l.stock_id, l.item_id, l.location_id, null, Math.abs(diff), diff > 0 ? "in" : "out", req.user.name,
        diff > 0 ? "ortiqcha topildi" : "kamlik");
    }
    doc = docFull(docId);
  }
  db.prepare("UPDATE counts SET status='yopilgan', closed_at=datetime('now') WHERE id=?").run(c.id);
  res.json({ ok: true, diffs: diffs.length, doc });
}));

/* ---------------- Yetkazib beruvchilar ---------------- */
app.get("/api/suppliers", auth, wrap((req, res) => res.json(db.prepare("SELECT * FROM suppliers ORDER BY name").all())));
app.post("/api/suppliers", auth, wrap((req, res) => {
  const b = req.body || {};
  if (!b.name) throw new Error("Nomi kiritilishi shart");
  const r = db.prepare("INSERT INTO suppliers (name,phone,address,note) VALUES (?,?,?,?)").run(b.name, b.phone || "", b.address || "", b.note || "");
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));
app.delete("/api/suppliers/:id", auth, wrap((req, res) => {
  const used = one("SELECT COUNT(*) c FROM items WHERE supplier_id=?", Number(req.params.id));
  if (used) throw new Error(`${used} ta tovar shu yetkazib beruvchiga bog'langan`);
  db.prepare("DELETE FROM suppliers WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
}));

/* ---------------- Hisobotlar ---------------- */
app.get("/api/report/dashboard", auth, wrap((req, res) => {
  const docs = db.prepare("SELECT type, COUNT(*) c FROM docs WHERE status='tasdiqlandi' GROUP BY type").all();
  const byType = Object.fromEntries(docs.map((d) => [d.type, d.c]));
  res.json({
    items: one("SELECT COUNT(*) c FROM items WHERE active=1"),
    locations: one("SELECT COUNT(*) c FROM locations WHERE active=1"),
    positions: one("SELECT COUNT(*) c FROM stocks WHERE qty>0"),
    total_qty: one("SELECT IFNULL(SUM(qty),0) c FROM stocks"),
    value: one("SELECT IFNULL(SUM(s.qty*i.cost),0) c FROM stocks s JOIN items i ON i.id=s.item_id"),
    drafts: one("SELECT COUNT(*) c FROM docs WHERE status='draft'"),
    today: db.prepare("SELECT type, COUNT(*) c, IFNULL(SUM(total_qty),0) q FROM docs WHERE status='tasdiqlandi' AND date(confirmed_at)=date('now','localtime') GROUP BY type").all(),
    by_type: byType,
    month_in: one("SELECT IFNULL(SUM(m.qty),0) c FROM movements m WHERE m.doc_type='kirish' AND strftime('%Y-%m',m.created_at)=strftime('%Y-%m','now','localtime')"),
    month_out: one("SELECT IFNULL(SUM(m.qty),0) c FROM movements m WHERE m.direction='out' AND m.doc_type<>'bekor' AND strftime('%Y-%m',m.created_at)=strftime('%Y-%m','now','localtime')"),
    low: lowStock(),
    expiring: db.prepare(STOCK_SQL + " WHERE s.qty>0 AND s.expiry<>'' AND date(s.expiry)<=date('now','+90 day') ORDER BY s.expiry LIMIT 20").all(),
    recent: db.prepare("SELECT * FROM docs ORDER BY id DESC LIMIT 8").all()
  });
}));

app.get("/api/report/placement", auth, wrap((req, res) => {
  const loc = String(req.query.loc || "");
  const cat = String(req.query.cat || "");
  const q = String(req.query.q || "");
  const w = ["s.qty > 0"];
  const p = [];
  if (loc) {
    w.push("l.code = ?");
    p.push(loc);
  }
  if (cat) {
    w.push("i.category = ?");
    p.push(cat);
  }
  if (q) {
    w.push("(i.name LIKE ? OR i.barcode LIKE ? OR i.sku LIKE ?)");
    p.push("%" + q + "%", "%" + q + "%", "%" + q + "%");
  }
  const where = " WHERE " + w.join(" AND ");
  const rows = db
    .prepare(
      `SELECT s.id, s.code, s.cell_row, s.cell_col, s.batch_no, s.expiry, s.qty, s.min_qty,
              i.name item_name, i.sku item_sku, i.barcode, i.category, i.unit, i.min_stock, i.cost,
              l.code loc_code, l.zone, l.name loc_name
       FROM stocks s JOIN items i ON i.id=s.item_id JOIN locations l ON l.id=s.location_id` + where +
        " ORDER BY l.zone, l.code, s.cell_row, s.cell_col, i.name"
    )
    .all(...p);
  const byItem = new Map();
  for (const r of rows) {
    if (!byItem.has(r.item_name))
      byItem.set(r.item_name, {
        name: r.item_name, sku: r.item_sku, barcode: r.barcode, category: r.category, unit: r.unit,
        min_stock: r.min_stock, cost: r.cost, total: 0, positions: []
      });
    const it = byItem.get(r.item_name);
    it.total += r.qty;
    it.positions.push({
      id: r.id, loc: r.loc_code, zone: r.zone, loc_name: r.loc_name, cell: `${r.cell_row}-${r.cell_col}`,
      code: r.code, qty: r.qty, batch_no: r.batch_no, expiry: r.expiry
    });
  }
  const items = [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name));
  res.json({
    items,
    rows: rows.length,
    total_qty: rows.reduce((a, r) => a + r.qty, 0),
    total_value: rows.reduce((a, r) => a + r.qty * r.cost, 0),
    zones: [...new Set(rows.map((r) => r.zone))].sort(),
    cats: [...new Set(rows.map((r) => r.category))].sort()
  });
}));

app.get("/api/report/balance", auth, wrap((req, res) => {
  const loc = String(req.query.loc || "");
  const cat = String(req.query.cat || "");
  let sql = `SELECT i.name, i.sku, i.unit, i.category, i.cost, l.code loc_code, l.zone,
                    s.cell_row, s.cell_col, s.batch_no, s.expiry, s.qty, s.min_qty, i.min_stock,
                    s.qty * i.cost value
             FROM stocks s JOIN items i ON i.id=s.item_id JOIN locations l ON l.id=s.location_id
             WHERE s.qty > 0`;
  const p = [];
  if (loc) {
    sql += " AND l.code=?";
    p.push(loc);
  }
  if (cat) {
    sql += " AND i.category=?";
    p.push(cat);
  }
  sql += " ORDER BY l.zone, l.code, s.cell_row, s.cell_col";
  const rows = db.prepare(sql).all(...p);
  res.json({
    rows,
    sum_qty: rows.reduce((a, r) => a + r.qty, 0),
    sum_value: rows.reduce((a, r) => a + r.qty * r.cost, 0)
  });
}));

app.get("/api/report/turnover", auth, wrap((req, res) => {
  const rows = db
    .prepare(
      `SELECT i.name, i.unit, i.category,
              IFNULL(SUM(CASE WHEN m.doc_type='kirish' THEN m.qty END),0) kirim,
              IFNULL(SUM(CASE WHEN m.direction='out' AND m.doc_type<>'bekor' THEN m.qty END),0) chiqim
       FROM items i LEFT JOIN movements m ON m.item_id=i.id
       WHERE i.active=1 GROUP BY i.id HAVING kirim>0 OR chiqim>0 ORDER BY chiqim DESC, kirim DESC`
    )
    .all();
  res.json(rows);
}));

app.get("/api/export", auth, wrap((req, res) => {
  const t = String(req.query.t || "balance");
  if (t === "movements") return res.json(db.prepare("SELECT m.*, i.name FROM movements m JOIN items i ON i.id=m.item_id ORDER BY m.id DESC LIMIT 1000").all());
  if (t === "items") return res.json(db.prepare("SELECT * FROM items WHERE active=1").all());
  res.json(db.prepare(STOCK_SQL + " WHERE s.qty>0 ORDER BY l.zone, l.code, s.cell_row, s.cell_col").all());
}));

app.post("/api/settings", auth, wrap((req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) setSetting(k, v);
  res.json({ ok: true });
}));

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`OMBOR (WMS) dasturi: http://localhost:${PORT}`);
  console.log("Login: admin / 1234");
});
