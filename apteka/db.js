const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const dir = __dirname;
const db = new DatabaseSync(path.join(dir, "sklad.db"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL,
  pass TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ombor xodimi',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  form TEXT NOT NULL DEFAULT 'tabletka',
  category TEXT NOT NULL DEFAULT 'boshqa',
  unit TEXT NOT NULL DEFAULT 'dona',
  image TEXT NOT NULL DEFAULT '',
  cost INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 10,
  max_stock INTEGER NOT NULL DEFAULT 200,
  supplier_id INTEGER,
  shelf_hint TEXT DEFAULT '',
  note TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  zone TEXT NOT NULL DEFAULT 'A',
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'stelyaj',
  rows INTEGER NOT NULL DEFAULT 4,
  cols INTEGER NOT NULL DEFAULT 6,
  cell_cap INTEGER NOT NULL DEFAULT 60,
  building TEXT NOT NULL DEFAULT 'Bino-1',
  room TEXT NOT NULL DEFAULT 'Xona-1',
  floor INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  cell_row INTEGER NOT NULL DEFAULT 1,
  cell_col INTEGER NOT NULL DEFAULT 1,
  batch_no TEXT DEFAULT '',
  expiry TEXT DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'faol',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  supplier_id INTEGER,
  dest TEXT DEFAULT '',
  doc_date TEXT NOT NULL DEFAULT (date('now')),
  note TEXT DEFAULT '',
  lines_count INTEGER NOT NULL DEFAULT 0,
  total_qty INTEGER NOT NULL DEFAULT 0,
  user TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS doc_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES docs(id),
  stock_id INTEGER,
  item_id INTEGER NOT NULL,
  location_id INTEGER,
  cell_row INTEGER DEFAULT 1,
  cell_col INTEGER DEFAULT 1,
  to_location_id INTEGER,
  to_cell_row INTEGER DEFAULT 1,
  to_cell_col INTEGER DEFAULT 1,
  qty INTEGER NOT NULL DEFAULT 0,
  batch_no TEXT DEFAULT '',
  expiry TEXT DEFAULT '',
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER,
  doc_no TEXT DEFAULT '',
  doc_type TEXT NOT NULL,
  stock_id INTEGER,
  item_id INTEGER NOT NULL,
  location_id INTEGER,
  to_location_id INTEGER,
  qty INTEGER NOT NULL,
  direction TEXT NOT NULL DEFAULT 'in',
  balance_after INTEGER,
  user TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT UNIQUE NOT NULL,
  location_id INTEGER,
  status TEXT NOT NULL DEFAULT 'ochilgan',
  doc_date TEXT NOT NULL DEFAULT (date('now')),
  user TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id INTEGER NOT NULL REFERENCES counts(id),
  stock_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  cell_row INTEGER DEFAULT 1,
  cell_col INTEGER DEFAULT 1,
  system_qty INTEGER NOT NULL DEFAULT 0,
  actual_qty INTEGER,
  counted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/* --- migratsiya: bino / xona / qavat --- */
{
  const have = new Set(db.prepare("PRAGMA table_info(locations)").all().map((c) => c.name));
  const mig = [
    ["building", "TEXT NOT NULL DEFAULT 'Bino-1'"],
    ["room", "TEXT NOT NULL DEFAULT 'Xona-1'"],
    ["floor", "INTEGER NOT NULL DEFAULT 1"],
  ];
  for (const [n, t] of mig) if (!have.has(n)) db.exec(`ALTER TABLE locations ADD COLUMN ${n} ${t}`);
  db.exec("UPDATE locations SET building='Bino-1' WHERE building IS NULL OR building=''");
  db.exec("UPDATE locations SET room='Xona-1', floor=1 WHERE room IS NULL OR room=''");
}

const DOC_TYPES = {
  kirish: "Kirim (tovarlar kiritish)",
  chiqim: "Chiqim (berish/yuborish)",
  "ko'chirish": "Ko'chirish (pozitsiya almashdirish)",
  "yo'qotish": "Yo'qotish / hisobdan chiqarish",
  inventarizatsiya: "Inventarizatsiya (farqni ta'mirlash)"
};

function getSetting(key, fallback) {
  const r = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return r ? String(r.value) : fallback;
}

function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value));
}

const bcode = (n) => "20" + String(1000000000 + n * 7919).slice(0, 10);

if (!db.prepare("SELECT COUNT(*) c FROM users").get().c) {
  const ins = db.prepare("INSERT INTO users (login,pass,name,role) VALUES (?,?,?,?)");
  ins.run("admin", "1234", "Ombor muddiri", "mudir");
  ins.run("sklad", "1234", "Ombor xodimi", "ombor xodimi");
}

if (!db.prepare("SELECT COUNT(*) c FROM suppliers").get().c) {
  const ins = db.prepare("INSERT INTO suppliers (name,phone,address) VALUES (?,?,?)");
  ins.run("O'zbekfarm", "+998 71 200 10 10", "Toshkent, Yunusobod");
  ins.run("Pharmstandard", "+998 71 300 20 20", "Toshkent, Sergeli");
  ins.run("Sandoz O'zbekiston", "+998 71 400 30 30", "Toshkent, Chilanzar");
  ins.run("Bayer O'zbekiston", "+998 71 500 40 40", "Toshkent, Shaybaantol");
}

const ITEMS = [
  ["Paracetamol", "tabletka", "og'riq qoldiruvchi", "dona", 8500, 20, 200, 1],
  ["Ibuprofen", "tabletka", "og'riq qoldiruvchi", "dona", 13000, 20, 200, 1],
  ["Aspirin", "tabletka", "qon quyishni to'xtatuvchi", "dona", 11000, 15, 150, 4],
  ["Amoxicillin", "kapsula", "antibiotik", "dona", 32000, 15, 120, 2],
  ["Azitromitsin", "tabletka", "antibiotik", "dona", 27000, 15, 120, 3],
  ["Ciprofloxacin", "tabletka", "antibiotik", "dona", 23000, 12, 100, 2],
  ["Nifuroksazid", "kapsula", "ich qorashi", "dona", 18000, 20, 200, 2],
  ["Metronidazol", "tabletka", "ich qorashi", "dona", 15000, 20, 200, 3],
  ["Omeprazol", "kapsula", "oshqozon", "dona", 29000, 12, 100, 1],
  ["Pantoprazol", "tabletka", "oshqozon", "dona", 19000, 15, 120, 3],
  ["Laktievit", "sirup", "vitamin", "shisha", 38000, 10, 80, 3],
  ["Vitamin C", "tabletka", "vitamin", "dona", 14000, 20, 200, 1],
  ["Multivitamin", "kapsula", "vitamin", "quti", 45000, 8, 60, 1],
  ["Ferrobut", "kapsula", "qon to'ldiruvchi", "dona", 25000, 12, 100, 2],
  ["Glukoz", "tabletka", "qon shakari", "dona", 16000, 20, 200, 1],
  ["Insulin", "inyeksiya", "qon shakari", "shisha", 140000, 6, 40, 4],
  ["Nitroglycerin", "tabletka", "yurak", "dona", 19000, 10, 80, 4],
  ["Amlodipin", "tabletka", "boshi", "dona", 17000, 15, 120, 1],
  ["Enalapril", "tabletka", "boshi", "dona", 21000, 15, 120, 1],
  ["Atorvastatin", "tabletka", "qon yog'i", "dona", 30000, 12, 100, 1],
  ["Salbutamol", "inhaler", "nafas", "dona", 40000, 8, 60, 4],
  ["Loratadin", "tabletka", "allergiya", "dona", 12000, 20, 200, 4],
  ["Cetirizin", "tabletka", "allergiya", "dona", 11000, 20, 200, 1],
  ["Prednizolon", "tabletka", "gormon", "dona", 24000, 10, 80, 3],
  ["Dextrometorfan", "sirup", "yo'tal", "shisha", 20000, 10, 80, 3],
  ["Xolin", "tabletka", "yurak", "dona", 10000, 20, 200, 1]
];

const SHELF_OF = [
  "A-1", "A-1", "A-2", "A-3", "A-3", "A-3", "A-4", "A-4", "B-1", "B-1", "B-2", "B-2", "B-2",
  "B-3", "B-3", "B-4", "C-1", "C-1", "C-1", "C-2", "C-3", "D-1", "D-1", "D-2", "D-3", "C-1"
];

if (!db.prepare("SELECT COUNT(*) c FROM items").get().c) {
  const insI = db.prepare(
    "INSERT INTO items (sku,barcode,name,form,category,unit,cost,min_stock,max_stock,supplier_id,shelf_hint) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  const insS = db.prepare(
    "INSERT INTO stocks (code,item_id,location_id,cell_row,cell_col,batch_no,expiry,qty,min_qty) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  const insL = db.prepare("INSERT INTO locations (code,zone,name,kind,rows,cols,cell_cap,building,room,floor) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const zoneName = {
    A: "Analgezik / antibiotik", B: "Oshqozon / vitamin", C: "Yurak / qon", D: "Allergiya / gormon",
    A2: "Zaxira: analgezik", B2: "Zaxira: oshqozon", C2: "Zaxira: yurak / qon", D2: "Zaxira: allergiya",
  };
  const locMap = new Map();
  const mk = (code, z, bld, room, floor) =>
    locMap.set(code, Number(insL.run(code, z, zoneName[z] || "Umumiy", "stelyaj", 4, 6, 60, bld, room, floor).lastInsertRowid));
  [...new Set(SHELF_OF)].forEach((code) => mk(code, code.split("-")[0], "Bino-1", "Xona-1", 1));
  ["A2", "B2", "C2", "D2"].forEach((z) => {
    for (let i = 1; i <= 3; i++) mk(z + "-" + i, z, "Bino-1", "Xona-2", 2);
  });
  const used = {};
  ITEMS.forEach(([name, form, cat, unit, cost, mn, mx, sup], i) => {
    const sku = "MD" + String(100000 + i * 13);
    const r = insI.run(sku, bcode(i + 1), name, form, cat, unit, cost, mn, mx, sup, SHELF_OF[i]);
    const shelf = SHELF_OF[i];
    const n = used[shelf] || 0;
    const row = Math.floor(n / 6) + 1;
    const col = (n % 6) + 1;
    used[shelf] = n + 1;
    insS.run(
      "PK-" + String(row).padStart(2, "0") + String(col).padStart(2, "0") + "-" + sku.slice(2),
      Number(r.lastInsertRowid), locMap.get(shelf), row, col,
      "P-" + (2025 + (i % 2)) + String(100 + i), "202" + (6 + (i % 3)) + "-0" + ((i % 9) + 1) + "-28",
      25 + (i % 7) * 6, 5
    );
  });
}

/* --- A2 / B2 / C2 / D2 zonalari tayyorlash (mavjud bazaga ham qo'shiladi) --- */
{
  const zn = {
    A2: "Zaxira: analgezik", B2: "Zaxira: oshqozon",
    C2: "Zaxira: yurak / qon", D2: "Zaxira: allergiya",
  };
  const has = db.prepare("SELECT id FROM locations WHERE code=?");
  const add = db.prepare(
    "INSERT INTO locations (code,zone,name,kind,rows,cols,cell_cap,building,room,floor) VALUES (?,?,?,?,?,?,?,?,?,?)"
  );
  for (const z of Object.keys(zn))
    for (let i = 1; i <= 3; i++) {
      const code = z + "-" + i;
      if (!has.get(code)) add.run(code, z, zn[z], "stelyaj", 4, 6, 60, "Bino-1", "Xona-2", 2);
    }
  /* A2 zonasiga namuna tovarlar */
  const a2items = db.prepare("SELECT id, sku FROM items ORDER BY id LIMIT 6").all();
  const put = db.prepare(
    "INSERT INTO stocks (code,item_id,location_id,cell_row,cell_col,batch_no,expiry,qty,min_qty) VALUES (?,?,?,?,?,?,?,?,?)"
  );
  a2items.forEach((it, i) => {
    const code = ["A2-1", "A2-2", "A2-3"][i % 3];
    const loc = has.get(code);
    if (!loc) return;
    const row = Math.floor(i / 3) + 1, col = 1;
    if (db.prepare("SELECT 1 FROM stocks WHERE item_id=? AND location_id=? AND cell_row=? AND cell_col=?").get(it.id, loc.id, row, col)) return;
    put.run("PK-A2" + row + col + "-" + it.sku.slice(2), it.id, loc.id, row, col,
      "A2-" + (100 + i), "2027-0" + ((i % 9) + 1) + "-15", 12 + i * 4, 5);
  });
}

if (!db.prepare("SELECT COUNT(*) c FROM docs").get().c) {
  const docNo = (t, n) => ({ kirish: "KR", chiqim: "CH", "ko'chirish": "KC", "yo'qotish": "YQ", inventarizatsiya: "IN" }[t]) + "-" + new Date().getFullYear() + "-" + String(n).padStart(4, "0");
  const pick = db.prepare("SELECT * FROM stocks WHERE qty > 10 LIMIT 3").all();
  const mk = (type, note, lines) => {
    const d = db.prepare("INSERT INTO docs (no,type,status,note,lines_count,total_qty,user,doc_date) VALUES (?,?,?,?,?,?,?,?)").run(
      docNo(type, db.prepare("SELECT COUNT(*) c FROM docs").get().c + 1), type, "tasdiqlandi", note, lines.length,
      lines.reduce((a, l) => a + l.qty, 0), "admin", new Date().toISOString().slice(0, 10)
    );
    const id = Number(d.lastInsertRowid);
    for (const l of lines) {
      db.prepare(
        "INSERT INTO doc_lines (doc_id,stock_id,item_id,location_id,cell_row,cell_col,to_location_id,to_cell_row,to_cell_col,qty,batch_no,expiry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
      ).run(id, l.stock_id, l.item_id, l.location_id, l.cell_row, l.cell_col, l.to_location_id || null, l.to_cell_row || 1, l.to_cell_col || 1, l.qty, l.batch_no || "", l.expiry || "");
      db.prepare(
        "INSERT INTO movements (doc_id,doc_no,doc_type,stock_id,item_id,location_id,to_location_id,qty,direction,balance_after,user) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).run(id, docNo(type, 1), type, l.stock_id, l.item_id, l.location_id, l.to_location_id || null, l.qty, l.dir, l.balance_after, "admin");
    }
  };
  mk("kirish", "Boshlash uchun o'qituvchi kirim", pick.map((s) => ({ stock_id: s.id, item_id: s.item_id, location_id: s.location_id, cell_row: s.cell_row, cell_col: s.cell_col, qty: 40, batch_no: s.batch_no, expiry: s.expiry, dir: "in", balance_after: s.qty + 40 })));
  db.prepare("UPDATE stocks SET qty = qty + 40 WHERE id IN (SELECT stock_id FROM doc_lines WHERE doc_id = 1)").run();
  mk("chiqim", "Apteka peshtaxtasiga chiqim", pick.slice(0, 2).map((s) => ({ stock_id: s.id, item_id: s.item_id, location_id: s.location_id, cell_row: s.cell_row, cell_col: s.cell_col, qty: 6, dir: "out", balance_after: s.qty + 40 - 6 })));
  db.prepare("UPDATE stocks SET qty = qty - 6 WHERE id IN (SELECT stock_id FROM doc_lines WHERE doc_id = 2)").run();
}

function nextNo(prefix, table) {
  const y = new Date().getFullYear();
  const base = `${prefix}-${y}-`;
  let n = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE no LIKE ?`).get(base + "%").c + 1;
  let no = base + String(n).padStart(4, "0");
  while (db.prepare(`SELECT 1 FROM ${table} WHERE no=?`).get(no)) no = base + String(++n).padStart(4, "0");
  return no;
}

function lowStock() {
  return db
    .prepare(
      `SELECT i.id,i.name,i.unit,i.min_stock, IFNULL(SUM(s.qty),0) qty
       FROM items i LEFT JOIN stocks s ON s.item_id = i.id
       WHERE i.active = 1 GROUP BY i.id HAVING qty <= i.min_stock ORDER BY (qty - i.min_stock)`
    )
    .all();
}

module.exports = { db, getSetting, setSetting, nextNo, lowStock, DOC_TYPES, bcode };
