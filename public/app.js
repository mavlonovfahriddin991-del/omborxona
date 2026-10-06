const $ = (id) => document.getElementById(id);

function showMsg(text, ok = false) {
  const m = $("msg");
  m.textContent = text;
  m.className = "msg " + (ok ? "ok" : "err");
}

async function tgAutoLogin() {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.initData) return false;
  try {
    await api("/api/tg-auth", { method: "POST", body: { initData: tg.initData } });
    return true;
  } catch {
    return false;
  }
}

async function init() {
  let me = null;
  try {
    me = (await api("/api/me")).user;
  } catch {
    if (await tgAutoLogin()) {
      me = (await api("/api/me")).user;
    }
  }
  if (!me) {
    document.getElementById("auth-warning").style.display = "";
    document.getElementById("vote-panel").style.display = "none";
    return;
  }

  const info = await api("/api/vote-info");
  $("target-id").textContent = info.target || "Belgilanmagan";
  $("reward-txt").textContent = fmt(info.reward);
  $("balance-chip").textContent = "Balans: " + fmt(me.balance);

  $("submit-btn").addEventListener("click", async () => {
    const btn = $("submit-btn");
    const file = $("photo").files[0];
    if (!file) return showMsg("Avval skrinshot tanlang");
    if (!info.target) return showMsg("Hozircha ovoz berish yoqilmagan");
    btn.disabled = true;
    btn.textContent = "YUKLANMOQDA...";
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/vote-proof", { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Xatolik");
      showMsg(`✅ Qabul qilindi (#${data.order_id})! Admin tekshirgach balansga pul tushadi.`, true);
      $("photo").value = "";
    } catch (e) {
      showMsg(e.message);
    }
    btn.disabled = false;
    btn.textContent = "🗳 OVOZ BERDIM — YUBORISH";
  });

  const tg2 = window.Telegram && window.Telegram.WebApp;
  if (tg2 && tg2.ready) tg2.ready();
}

init();
