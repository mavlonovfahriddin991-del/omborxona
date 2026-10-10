const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const bcrypt = require("bcryptjs");

const db = new DatabaseSync(path.join(__dirname, "market.db"));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🛒',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Toshkent'
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📦',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS stocks (
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);
CREATE TABLE IF NOT EXISTS food_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🍽️',
  rating REAL NOT NULL DEFAULT 4.5,
  delivery_min INTEGER NOT NULL DEFAULT 30
);
CREATE TABLE IF NOT EXISTS food_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🍽️',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'market',
  items TEXT NOT NULL,
  address_id INTEGER,
  address_text TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'yangi',
  warehouses TEXT NOT NULL DEFAULT '[]',
  delivery TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS taxi_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  car_class TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'yangi',
  driver TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const ORDER_STATUS = ["yangi", "tasdiqlandi", "yetkazilmoqda", "yetkazildi", "bekor qilindi"];
const TAXI_STATUS = ["yangi", "keldi", "yo'lda", "yakunlandi", "bekor qilindi"];

const orderCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!orderCols.includes("delivery")) db.exec("ALTER TABLE orders ADD COLUMN delivery TEXT NOT NULL DEFAULT ''");

const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("google_email")) db.exec("ALTER TABLE users ADD COLUMN google_email TEXT");
if (!userCols.includes("google_name")) db.exec("ALTER TABLE users ADD COLUMN google_name TEXT");
if (!userCols.includes("banned")) db.exec("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0");

const CITY_DAYS = { Toshkent: [1, 2], Samarqand: [2, 3], Buxoro: [3, 4] };

function deliveryRange(cities) {
  const ranges = (cities.length ? cities : ["Boshqa"]).map((c) => CITY_DAYS[c] || [3, 5]);
  const min = Math.min(...ranges.map((r) => r[0]));
  const max = Math.max(...ranges.map((r) => r[1]));
  return `${min}-${max} kun`;
}

function seed() {
  const adminPass = process.env.MARKET_ADMIN_PASS || "admin123";
  if (!db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get())
    db.prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)").run(
      "admin",
      bcrypt.hashSync(adminPass, 10)
    );

  if (!db.prepare("SELECT COUNT(*) c FROM warehouses").get().c) {
    const w = db.prepare("INSERT INTO warehouses (name, address, city) VALUES (?, ?, ?)");
    w.run("Toshkent ombori", "Yunusobod tumani, Chilonzor 12", "Toshkent");
    w.run("Samarqand ombori", "Registon ko'chasi 45", "Samarqand");
    w.run("Buxoro ombori", "Mustaqillik shoh ko'chasi 7", "Buxoro");
  }

  const cats = [
    ["Kiyim-kechak", "👗"], ["Oyoq kiyim", "👢"], ["Kitoblar", "📚"],
    ["Futbol formalar", "🎽"], ["Koptoklar", "🏀"], ["O'yinchoqlar", "🧸"],
    ["Sumkalar", "👜"], ["Kabellar", "🔌"], ["Uy soatlari", "🕰️"],
    ["Qo'l soatlar", "⌚"], ["Maktab formalar", "🎒"], ["Zargarlik", "💍"],
    ["Lampochkalar", "💡"], ["Sarakanoshkalar", "👟"],
  ];
  if (!db.prepare("SELECT COUNT(*) c FROM categories").get().c) {
    const c = db.prepare("INSERT INTO categories (name, emoji, sort) VALUES (?, ?, ?)");
    cats.forEach(([n, e], i) => c.run(n, e, i + 1));
  }

  const products = [
    ["Kiyim-kechak", "Erkaklar ko'ylagi (oq)", 149000, "👔"],
    ["Kiyim-kechak", "Ayollar ko'yligi", 189000, "👗"],
    ["Kiyim-kechak", "Jinsilar (ko'k)", 229000, "👖"],
    ["Kiyim-kechak", "Krossovka kurtka", 349000, "🧥"],
    ["Kiyim-kechak", "Futbolka (qora)", 79000, "👕"],
    ["Kiyim-kechak", "Shim (qora)", 199000, "🩳"],
    ["Oyoq kiyim", "Boots — teri, qora", 459000, "👢"],
    ["Oyoq kiyim", "Oq krossovka", 329000, "👟"],
    ["Oyoq kiyim", "Shinam krossovka", 389000, "🥾"],
    ["Oyoq kiyim", "Oyoq kiyim — klassik", 419000, "👞"],
    ["Oyoq kiyim", "Uy sochasi", 59000, "🩴"],
    ["Kitoblar", "Darslik — matematika", 45000, "📖"],
    ["Kitoblar", "Roman — «Sariq devni minib»", 65000, "📕"],
    ["Kitoblar", "Bolalar ertaklari", 39000, "📗"],
    ["Kitoblar", "Ingliz tili lug'ati", 89000, "📘"],
    ["Kitoblar", "Kompyuter dasturlash asoslari", 129000, "💻"],
    ["Futbol formalar", "«Paxtakor» futbolka", 199000, "🎽"],
    ["Futbol formalar", "«Nasaf» forma to'plami", 249000, "⚽"],
    ["Futbol formalar", "Milliy terma forma", 279000, "🏅"],
    ["Futbol formalar", "Jamoaviy forma (sariq)", 179000, "👕"],
    ["Koptoklar", "Futbol to'pi (size 5)", 129000, "⚽"],
    ["Koptoklar", "Basketbol to'pi", 149000, "🏀"],
    ["Koptoklar", "Volleybol to'pi", 119000, "🏐"],
    ["Koptoklar", "O'yin to'pi (yengil)", 59000, "🎾"],
    ["O'yinchoqlar", "Yumshoq o'yinchoq — Ayiq", 99000, "🧸"],
    ["O'yinchoqlar", "Konstruktor (500 detal)", 189000, "🧱"],
    ["O'yinchoqlar", "Masincha (akkumulyatorli)", 349000, "🚗"],
    ["O'yinchoqlar", "Qo'g'irchoq (Barbi)", 129000, "🪆"],
    ["O'yinchoqlar", "Puzle — 1000 detal", 79000, "🧩"],
    ["Sumkalar", "Ayollar sumkasi (teri)", 289000, "👜"],
    ["Sumkalar", "Pryalni sumka", 199000, "🎒"],
    ["Sumkalar", "Sport sumka", 159000, "💼"],
    ["Sumkalar", "Velosiped sumkasi", 119000, "👝"],
    ["Kabellar", "USB-C kabel (1m)", 25000, "🔌"],
    ["Kabellar", "Lightning kabel (2m)", 45000, "⚡"],
    ["Kabellar", "HDMI kabel (3m)", 55000, "🖥️"],
    ["Kabellar", "Quvvatlagich (22.5W)", 89000, "🔋"],
    ["Uy soatlari", "Devor soati — klassik", 149000, "🕰️"],
    ["Uy soatlari", "Radial soati (zamonaviy)", 229000, "⏰"],
    ["Uy soatlari", "Bolalar xonasi soati", 99000, "⏱️"],
    ["Qo'l soatlar", "Mecha — qora remeshok", 259000, "⌚"],
    ["Qo'l soatlar", "Sport qo'l soati", 349000, "⌚"],
    ["Qo'l soatlar", "Klassik qo'l soati (mis)", 199000, "⌚"],
    ["Maktab formalar", "O'g'il bolalar kostyumi", 389000, "🎽"],
    ["Maktab formalar", "Qizlar ko'ylagi + plise", 349000, "👚"],
    ["Maktab formalar", "Maktab ryukzaki", 259000, "🎒"],
    ["Maktab formalar", "Matematik to'plam (1-sinf)", 89000, "✏️"],
    ["Zargarlik", "Oltin sirg'a (585)", 1290000, "💎"],
    ["Zargarlik", "Kumush bilaguzuk", 349000, "💍"],
    ["Zargarlik", "Zumrad marjon", 479000, "📿"],
    ["Zargarlik", "Uzuk (toshli)", 599000, "💍"],
    ["Lampochkalar", "LED lampochka (12W)", 29000, "💡"],
    ["Lampochkalar", "Chiroq turi — LED, 9W", 35000, "🔆"],
    ["Lampochkalar", "RGB lampochka (Wi-Fi)", 89000, "🌈"],
    ["Lampochkalar", "Lamba — stol uchun", 179000, "🛋️"],
    ["Sarakanoshkalar", "Sarakanoshka — oq", 289000, "👟"],
    ["Sarakanoshkalar", "Sarakanoshka — qora", 289000, "👟"],
    ["Sarakanoshkalar", "Sarakanoshka — sport", 319000, "👟"],
  ];

  if (!db.prepare("SELECT COUNT(*) c FROM products").get().c) {
    const catId = {};
    db.prepare("SELECT id, name FROM categories").all().forEach((r) => (catId[r.name] = r.id));
    const whs = db.prepare("SELECT id FROM warehouses").all().map((r) => r.id);
    const p = db.prepare("INSERT INTO products (category_id, name, price, emoji) VALUES (?, ?, ?, ?)");
    const s = db.prepare("INSERT INTO stocks (product_id, warehouse_id, qty) VALUES (?, ?, ?)");
    products.forEach(([cat, name, price, emoji], i) => {
      const info = p.run(catId[cat], name, price, emoji);
      const pid = Number(info.lastInsertRowid);
      const first = whs[i % whs.length];
      const second = whs[(i + 1) % whs.length];
      s.run(pid, first, 20 + ((i * 7) % 60));
      s.run(pid, second, 10 + ((i * 3) % 40));
    });
  }

  const places = [
    ["Chaikhana «Registon»", "🥟", 4.8, 35],
    ["Burger House", "🍔", 4.6, 25],
    ["Pitssa Lab", "🍕", 4.7, 30],
    ["Milliy taomlar — Oshxona", "🍲", 4.9, 40],
    ["Shashlik Saroy", "🍖", 4.8, 45],
    ["Sushi Roll", "🍣", 4.5, 35],
  ];
  if (!db.prepare("SELECT COUNT(*) c FROM food_places").get().c) {
    const p = db.prepare("INSERT INTO food_places (name, emoji, rating, delivery_min) VALUES (?, ?, ?, ?)");
    const f = db.prepare("INSERT INTO food_items (place_id, name, price, emoji) VALUES (?, ?, ?, ?)");
    const menu = [
      [["Choy + non", 15000, "🫖"], ["Somsa (go'shtli)", 12000, "🥟"], ["Lag'mon", 28000, "🍜"], ["Norin", 25000, "🍝"]],
      [["Cheeseburger", 35000, "🍔"], ["Double burger", 48000, "🍔"], ["Fri kartoshka", 18000, "🍟"], ["Kola 0.5L", 12000, "🥤"]],
      [["Margarita pitssa", 65000, "🍕"], ["Peperoni pitssa", 75000, "🍕"], ["Chiz pitssa", 85000, "🧀"], ["Cesar salat", 42000, "🥗"]],
      [["Osh (o'zbek)", 45000, "🍲"], ["Sho'rva", 35000, "🥣"], ["Manti (5 dona)", 40000, "🥟"], ["Qaymoq+choy", 18000, "🍵"]],
      [["Tandir go'sht", 55000, "🍖"], ["Shashlik (6 six)", 72000, "🍢"], ["Jigar shashlik", 60000, "🍢"], ["Achchiq-chuchuk", 15000, "🥒"]],
      [["California roll", 55000, "🍣"], ["Filadelfiya", 68000, "🍣"], ["Wasa-bi set", 95000, "🍱"], ["Soya sous", 5000, "🥢"]],
    ];
    places.forEach(([name, emoji, rating, mins], i) => {
      const info = p.run(name, emoji, rating, mins);
      const pid = Number(info.lastInsertRowid);
      menu[i].forEach(([n, pr, e]) => f.run(pid, n, pr, e));
    });
  }
}

function seedTires() {
  if (db.prepare("SELECT 1 FROM categories WHERE name = 'Mashina balonlari'").get()) return;
  const info = db.prepare("INSERT INTO categories (name, emoji, sort) VALUES (?, ?, 15)").run("Mashina balonlari", "🛞");
  const catId = Number(info.lastInsertRowid);
  const whs = db.prepare("SELECT id FROM warehouses").all().map((r) => r.id);
  const tires = [
    ["Michelin 185/65 R15", 649000, "🛞"],
    ["Continental 195/65 R15", 589000, "🛞"],
    ["Lassa 205/55 R16", 549000, "🛞"],
    ["Bridgestone 205/60 R16", 699000, "🛞"],
    ["Hankook 215/55 R17", 749000, "🛞"],
    ["Pirelli 225/45 R17", 899000, "🛞"],
    ["Toyo 225/50 R17", 779000, "🛞"],
    ["Nokian qishki 215/60 R16", 829000, "❄️"],
    ["Cordiant qishki 195/65 R15", 479000, "❄️"],
    ["Gislaved Nord Frost 205/55 R16", 519000, "❄️"],
    ["Matador MP54 175/70 R14", 429000, "🛞"],
    ["Armstrong AR12 185/60 R15", 469000, "🛞"],
  ];
  const p = db.prepare("INSERT INTO products (category_id, name, price, emoji) VALUES (?, ?, ?, ?)");
  const s = db.prepare("INSERT INTO stocks (product_id, warehouse_id, qty) VALUES (?, ?, ?)");
  tires.forEach(([name, price, emoji], i) => {
    const pid = Number(p.run(catId, name, price, emoji).lastInsertRowid);
    s.run(pid, whs[i % whs.length], 15 + ((i * 5) % 40));
    s.run(pid, whs[(i + 1) % whs.length], 12 + ((i * 4) % 30));
  });
}

seed();
seedTires();

module.exports = { db, ORDER_STATUS, TAXI_STATUS, deliveryRange };
