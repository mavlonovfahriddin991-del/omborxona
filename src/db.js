const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const crypto = require("crypto");

const db = new DatabaseSync(path.join(__dirname, "..", "data.db"));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  telegram_id INTEGER UNIQUE,
  telegram_username TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  ref_code TEXT UNIQUE NOT NULL,
  ref_by INTEGER,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ob_id TEXT NOT NULL,
  service_id INTEGER NOT NULL,
  service_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ref_paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderCols.includes("proof_image")) db.exec("ALTER TABLE orders ADD COLUMN proof_image TEXT");
if (!orderCols.includes("ref_paid")) db.exec("ALTER TABLE orders ADD COLUMN ref_paid INTEGER NOT NULL DEFAULT 0");

function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? Number(row.value) : fallback;
}

function getSettingStr(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? String(row.value) : fallback;
}

function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(key), String(value));
}

if (!db.prepare("SELECT COUNT(*) c FROM services").get().c) {
  const ins = db.prepare("INSERT INTO services (name, price, kind, sort) VALUES (?, ?, ?, ?)");
  ins.run("50 ovoz", 20000, "other", 1);
  ins.run("100 ovoz", 35000, "other", 2);
  ins.run("500 ovoz", 150000, "other", 3);
}

const defaults = { id_price: 15000, ref_reward: 5000, signup_bonus: 3000, target_ob_id: "", vote_reward: 3000 };
for (const [k, v] of Object.entries(defaults)) if (!db.prepare("SELECT 1 FROM settings WHERE key=?").get(k)) setSetting(k, v);

function genRefCode() {
  while (true) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    if (!db.prepare("SELECT 1 FROM users WHERE ref_code = ?").get(code)) return code;
  }
}

module.exports = { db, getSetting, getSettingStr, setSetting, genRefCode };
