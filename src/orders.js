const { db, getSetting } = require("./db");
const botModule = require("./bot");

const STATUS_UZ = {
  checking: "Tekshirilmoqda",
  pending: "Kutilmoqda",
  processing: "Jarayonda",
  done: "Bajarildi",
  cancelled: "Rad etildi",
};

function credit(userId, amount, type, note) {
  db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, userId);
  db.prepare("INSERT INTO transactions (user_id, amount, type, note) VALUES (?, ?, ?, ?)").run(userId, amount, type, note);
}

function setOrderStatus(orderId, statusInput) {
  const status = setStatusAlias(statusInput) || statusInput;
  if (!STATUS_UZ[status]) return { ok: false, error: "Noto'g'ri holat" };
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(orderId));
  if (!o) return { ok: false, error: "Buyurtma topilmadi" };
  if (o.status === status) return { ok: true, order: o };
  if (status === "done" && !o.ref_paid) {
    credit(o.user_id, o.amount, "reward", `Ovoz tasdiqlandi — buyurtma #${o.id}`);
    const worker = db.prepare("SELECT ref_by FROM users WHERE id = ?").get(o.user_id);
    if (worker?.ref_by) {
      const reward = getSetting("ref_reward", 0);
      if (reward > 0) credit(worker.ref_by, reward, "referral", `Referal daromadi — buyurtma #${o.id}`);
    }
    db.prepare("UPDATE orders SET ref_paid = 1 WHERE id = ?").run(o.id);
  }
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, o.id);
  botModule.notifyUser(o.user_id, `📦 Buyurtma #${o.id} (${o.service_name}) holati: ${STATUS_UZ[status]}${o.ob_id ? `\nOB ID: ${o.ob_id}` : ""}`);
  return { ok: true, order: db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id) };
}

function setStatusAlias(input) {
  const s = String(input || "").trim().toLowerCase();
const alias = {
    kutilmoqda: "pending",
    pending: "pending",
    tekshirilmoqda: "checking",
    checking: "checking",
    jarayonda: "processing",
    processing: "processing",
    bajarildi: "done",
    done: "done",
    bekor: "cancelled",
    rad: "cancelled",
    rad_etildi: "cancelled",
    rejected: "cancelled",
    cancelled: "cancelled",
  };
  return alias[s] || null;
}

module.exports = { setOrderStatus, setStatusAlias, STATUS_UZ };
