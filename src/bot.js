const { Telegraf } = require("telegraf");
const config = require("./config");
const { db, getSetting, getSettingStr, setSetting, genRefCode } = require("./db");

let ordersModule;
function getOrders() {
  return (ordersModule ||= require("./orders"));
}

let bot = null;

function isAdminTg(from) {
  if (config.adminTelegramIds.includes(Number(from?.id))) return true;
  if (!from) return false;
  const u = db.prepare("SELECT is_admin FROM users WHERE telegram_id = ?").get(from.id);
  return !!(u && u.is_admin);
}

function setPrice(serviceId, price) {
  const s = db.prepare("SELECT * FROM services WHERE id = ?").get(Number(serviceId));
  if (!s || !(price >= 0)) return null;
  db.prepare("UPDATE services SET price = ? WHERE id = ?").run(Math.floor(price), s.id);
  if (s.kind === "id") setSetting("id_price", Math.floor(price));
  return db.prepare("SELECT * FROM services WHERE id = ?").get(s.id);
}

function findUserByTelegram(id) {
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(id);
}

function ensureBotUser(from, refCode) {
  let user = findUserByTelegram(from.id);
  if (user) {
    if (refCode && !user.ref_by) {
      const referrer = db.prepare("SELECT * FROM users WHERE ref_code = ? AND id != ?").get(refCode, user.id);
      if (referrer) db.prepare("UPDATE users SET ref_by = ? WHERE id = ?").run(referrer.id, user.id);
    }
    return user;
  }
  const base = (from.username || `tg${from.id}`).toLowerCase().replace(/[^a-z0-9_]/g, "");
  let username = base || `tg${from.id}`;
  let i = 1;
  while (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) username = `${base}${i++}`;
  let refBy = null;
  if (refCode) {
    const referrer = db.prepare("SELECT id FROM users WHERE ref_code = ?").get(refCode);
    if (referrer) refBy = referrer.id;
  }
  const bonus = getSetting("signup_bonus", 0);
  const info = db
    .prepare(
      "INSERT INTO users (username, telegram_id, telegram_username, balance, ref_code, ref_by) VALUES (?, ?, ?, 0, ?, ?)"
    )
    .run(username, from.id, from.username || null, genRefCode(), refBy);
  if (bonus > 0)
    db.prepare("INSERT INTO transactions (user_id, amount, type, note) VALUES (?, ?, 'bonus', 'Ro\'yxatdan o\'tish bonusi')").run(info.lastInsertRowid, bonus);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
}

const mainKeyboard = {
  keyboard: [
    ["🗳 Ovoz berish", "📦 Buyurtmalarim"],
    ["👥 Referal", "💳 Balans"],
  ],
  resize_keyboard: true,
};

async function startBot() {
  if (!config.botToken) {
    console.log("[bot] BOT_TOKEN yo'q — bot o'chirilgan");
    return;
  }
  bot = new Telegraf(config.botToken);
  bot.use((ctx, next) => {
    const from = ctx.from ? `@${ctx.from.username || ctx.from.id}` : "?";
    const text = ctx.message?.text || ctx.callbackQuery?.data || "";
    console.log(`[bot] ${from}: ${text}`);
    return next();
  });
  bot.start((ctx) => {
    const payload = ctx.startPayload || "";
    const m = payload.match(/^ref([A-F0-9]+)$/i);
    const code = m ? m[1] : /^[A-F0-9]{6,10}$/i.test(payload) ? payload.toUpperCase() : null;
    const user = ensureBotUser(ctx.from, code);
    const link = `https://t.me/${ctx.botInfo.username}?start=ref${user.ref_code}`;
    const target = getSettingStr("target_ob_id", "");
    ctx.reply(
      `Assalomu alaykum, ${ctx.from.first_name || ""}!\n\n` +
        `Bu — OPENBUDGET ovoz berish platformasi.${target ? `\nHozir ovoz berilayotgan ID: <b>${target}</b>` : ""}\n\n` +
        `Login: <code>${user.username}</code>\n` +
        `Balans: ${user.balance} so'm\n\n` +
        `Sizning referal linkingiz:\n${link}`,
      { parse_mode: "HTML", reply_markup: mainKeyboard }
    );
  });
  bot.hears("🗳 Ovoz berish", (ctx) => {
    const target = getSettingStr("target_ob_id", "");
    if (!target) return ctx.reply("Hozircha ovoz berish yoqilmagan.", { reply_markup: mainKeyboard });
    const reward = getSetting("vote_reward", 0);
    const isHttps = config.baseUrl.startsWith("https://");
    const extra = { parse_mode: "HTML", reply_markup: mainKeyboard };
    if (isHttps) {
      extra.reply_markup = {
        inline_keyboard: [[{ text: "🗳 OVOZ BERISH", web_app: { url: config.baseUrl } }]],
      };
    }
    ctx.reply(
      `🎯 <b>Ovoz beriladigan ID: ${target}</b>\n` +
        `💰 Mukofot: ${reward} so'm\n\n` +
        `1️⃣ openbudget.uz saytiga o'z raqamingiz bilan kiring\n` +
        `2️⃣ Shu ID'ga ovozingizni bering\n` +
        `3️⃣ Skrinshotini yuklang — admin tasdiqlasa pul tushadi\n\n` +
        (isHttps ? "Pastdagi tugma orqali kiriring 👇" : `Skrinshot yuklash: ${config.baseUrl}`),
      extra
    );
  });
  bot.hears("📦 Buyurtmalarim", (ctx) => {
    const user = findUserByTelegram(ctx.from.id);
    if (!user) return ctx.reply("Avval /start bosing.");
    const rows = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 5").all(user.id);
    if (!rows.length) return ctx.reply("Hozircha buyurtmalaringiz yo'q.", { reply_markup: mainKeyboard });
    const names = { checking: "Tekshirilmoqda", pending: "Kutilmoqda", processing: "Jarayonda", done: "Tasdiqlandi", cancelled: "Rad etildi" };
    ctx.reply(
      rows.map((o) => `#${o.id} | ${o.service_name}\nID: ${o.ob_id} | ${o.amount} so'm\nHolat: ${names[o.status] || o.status}`).join("\n\n"),
      { reply_markup: mainKeyboard }
    );
  });
  bot.hears("👥 Referal", (ctx) => {
    const user = findUserByTelegram(ctx.from.id);
    if (!user) return ctx.reply("Avval /start bosing.");
    const stats = db
      .prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM transactions WHERE user_id = ? AND type = 'referral'")
      .get(user.id);
    ctx.reply(
      `Sizning referral linkingiz:\nhttps://t.me/${ctx.botInfo.username}?start=ref${user.ref_code}\n\n` +
        `Referal orqali kelganlar: ${stats.c}\nReferal daromadi: ${stats.s} so'm`,
      { reply_markup: mainKeyboard }
    );
  });
  bot.hears("💳 Balans", (ctx) => {
    const user = findUserByTelegram(ctx.from.id);
    if (!user) return ctx.reply("Avval /start bosing.");
    ctx.reply(`Balansingiz: ${user.balance} so'm\nTo'ldirish uchun admin bilan bog'laning.`, { reply_markup: mainKeyboard });
  });
  bot.command("panel", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    ctx.reply(
      "🛠 <b>ADMIN BUYRUQLARI</b>\n\n" +
        "/sozlamalar — joriy narx va sozlamalar\n" +
        "/id 887766554 — ovoz beriladigan ID'ni belgilash\n" +
        "/mukofot 3000 — har bir ovoz mukofoti\n" +
        "/narx 2 25000 — paket narxi (eski)\n" +
        "/referal 7000 — referal mukofoti\n" +
        "/buyurtmalar — oxirgi buyurtmalar\n" +
        "/holat 5 bajarildi — buyurtma holati (tekshirilmoqda/bajarildi/rad)",
      { parse_mode: "HTML", reply_markup: mainKeyboard }
    );
  });

  bot.command("sozlamalar", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const target = getSettingStr("target_ob_id", "");
    ctx.reply(
      `⚙️ <b>SOZLAMALAR</b>\n\n` +
        `🎯 Ovoz beriladigan ID: <b>${target || "belgilanmagan"}</b>\n` +
        `Ovoz mukofoti: ${getSetting("vote_reward", 0)} so'm\n` +
        `Referal mukofoti: ${getSetting("ref_reward", 0)} so'm`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("mukofot", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const v = Number(ctx.message.text.split(/\s+/)[1]);
    if (!(v >= 0)) return ctx.reply("Foydalanish: /mukofot 3000");
    setSetting("vote_reward", Math.floor(v));
    ctx.reply(`✅ Har bir tasdiqlangan ovoz mukofoti: ${Math.floor(v)} so'm`);
  });

  bot.command("id", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const t = (ctx.message.text.split(/\s+/)[1] || "").trim();
    if (!/^\d{4,20}$/.test(t)) return ctx.reply("Foydalanish: /id 887766554\n(Mijozlar shu ID'ga ovoz beradi)");
    setSetting("target_ob_id", t);
    ctx.reply(`✅ Endi barcha ovozlar shu ID'ga boradi: <b>${t}</b>`, { parse_mode: "HTML" });
  });

  bot.command("narx", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const [, sid, sum] = ctx.message.text.split(/\s+/);
    const s = setPrice(sid, Number(sum));
    if (!s) return ctx.reply("Foydalanish: /narx 2 25000\nXizmat ID larini /sozlamalar da ko'ring");
    ctx.reply(`✅ "${s.name}" narxi: ${s.price} so'm`);
  });

  bot.command("referal", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const v = Number(ctx.message.text.split(/\s+/)[1]);
    if (!(v >= 0)) return ctx.reply("Foydalanish: /referal 7000");
    setSetting("ref_reward", Math.floor(v));
    ctx.reply(`✅ Referal mukofoti: ${Math.floor(v)} so'm`);
  });

  bot.command("bonus", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const v = Number(ctx.message.text.split(/\s+/)[1]);
    if (!(v >= 0)) return ctx.reply("Foydalanish: /bonus 5000");
    setSetting("signup_bonus", Math.floor(v));
    ctx.reply(`✅ Ro'yxatdan o'tish bonusi: ${Math.floor(v)} so'm`);
  });

  bot.command("buyurtmalar", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const arg = getOrders().setStatusAlias(ctx.message.text.split(/\s+/)[1] || "");
    const rows = arg
      ? db.prepare("SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status=? ORDER BY o.id DESC LIMIT 10").all(arg)
      : db.prepare("SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 10").all();
    if (!rows.length) return ctx.reply("Buyurtma topilmadi");
    ctx.reply(
      rows
        .map(
          (o) =>
            `#${o.id} | ${o.status === "done" ? "✅" : o.status === "cancelled" ? "❌" : "⏳"} ${getOrders().STATUS_UZ[o.status]}\n` +
            `Mijoz: ${o.username}\nXizmat: ${o.service_name}\nSumma: ${o.amount} so'm${o.ob_id ? `\nOB ID: ${o.ob_id}` : "\n(OB ID kiritilmagan)"}`
        )
        .join("\n\n")
    );
  });

  bot.command("holat", (ctx) => {
    if (!isAdminTg(ctx.from)) return ctx.reply("Sizda ruxsat yo'q");
    const [, oid, st] = ctx.message.text.split(/\s+/);
    const status = getOrders().setStatusAlias(st);
    if (!oid || !status)
      return ctx.reply("Foydalanish: /holat 5 bajarildi\nHolatlar: kutilmoqda / jarayonda / bajarildi / bekor");
    const r = getOrders().setOrderStatus(oid, status);
    if (!r.ok) return ctx.reply(`Xato: ${r.error}`);
    ctx.reply(`✅ Buyurtma #${r.order.id}: ${getOrders().STATUS_UZ[status]} qilindi`);
  });

  bot.catch((err) => console.error("[bot]", err.message));
  const me = await bot.telegram.getMe();
  bot.launch();
  console.log(`[bot] @${me.username} ishga tushdi — xabarlar kutilmoqda...`);
}

function notifyAdmins(text) {
  for (const id of config.adminTelegramIds) bot?.telegram.sendMessage(id, text).catch(() => {});
}

function notifyUser(userId, text) {
  const u = db.prepare("SELECT telegram_id FROM users WHERE id = ?").get(userId);
  if (u?.telegram_id) bot?.telegram.sendMessage(u.telegram_id, text).catch(() => {});
}

module.exports = { startBot, notifyAdmins, notifyUser, ensureBotUser };
