/* ================= YORDAMCHILAR ================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n) => Number(n).toLocaleString("uz-UZ") + " so'm";

async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi");
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

const state = {
  user: null,
  cats: [],
  products: [],
  food: [],
  classes: [],
  addresses: [],
  orders: [],
  taxiOrders: [],
  cart: JSON.parse(localStorage.getItem("bz_cart") || "[]"),
  cat: 0,
  q: "",
  txClass: "ekoi",
  authMode: "login",
  googleClientId: "",
  selectedAddr: Number(localStorage.getItem("bz_addr") || 0),
};

function saveCart() {
  localStorage.setItem("bz_cart", JSON.stringify(state.cart));
  const n = state.cart.reduce((s, i) => s + i.qty, 0);
  const b = $("#cartBadge");
  b.textContent = n;
  b.classList.toggle("hidden", n === 0);
}

/* ================= SPLASH ================= */
setTimeout(() => {
  $("#splash").classList.add("off");
  $("#app").classList.remove("hidden");
}, 2000);

/* ================= TABLAR (4 bo'lim) ================= */
$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => switchTab(btn.dataset.tab))
);
function switchTab(tab) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + tab).classList.remove("hidden");
  $("#searchWrap").style.visibility = tab === "shop" ? "visible" : "hidden";
  if (tab === "cart") renderCart();
  if (tab === "taxi") renderTaxi();
}

/* ================= MODALLAR ================= */
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }
$$("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));

/* ================= KIRISH OLDI (majburiy akkaunt) ================= */
function showGate() { $("#gate").classList.remove("hidden"); }
function hideGate() { $("#gate").classList.add("hidden"); }

$("#gatePass").addEventListener("click", () => openAuth("register"));

$("#googleBtn").addEventListener("click", () => {
  openModal("#googleModal");
});

async function googleLogin(body) {
  try {
    const d = await api("/api/google-login", "POST", body);
    closeModals();
    $("#googleForm").reset();
    $("#gErr").classList.add("hidden");
    await loadMe();
    hideGate();
    renderProfile();
    renderCart();
    toast(d.created ? "Google akkaunt bilan yangi akkaunt ochildi! ✅" : "Google hisobi bilan kirdingiz ✅");
  } catch (ex) {
    const e = $("#gErr");
    e.textContent = ex.message;
    e.classList.remove("hidden");
    toast(ex.message, true);
  }
}

$("#googleForm").addEventListener("submit", (e) => {
  e.preventDefault();
  googleLogin({ email: $("#gEmail").value.trim(), name: $("#gName").value.trim() });
});

async function initGoogle(clientId) {
  if (!clientId) return;
  state.googleClientId = clientId;
  try {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (r) => googleLogin({ credential: r.credential }),
    });
    $("#gbtnWrap").innerHTML = "";
    google.accounts.id.renderButton($("#gbtnWrap"), { theme: "filled_black", size: "large", width: 300, text: "continue_with" });
  } catch {
    state.googleClientId = "";
  }
}

/* ================= AUTH ================= */
$("#profileBtn").addEventListener("click", () => {
  if (state.user) renderProfile();
  else openAuth("login");
  openModal("#profileModal");
});

function openAuth(mode) {
  state.authMode = mode;
  setAuthMode(mode);
  closeModals();
  openModal("#authModal");
}
function setAuthMode(mode) {
  state.authMode = mode;
  $$(".auth-tab").forEach((b) => b.classList.toggle("active", b.dataset.auth === mode));
  $("#authPass2").classList.toggle("hidden", mode === "login");
  $("#pass2Label").classList.toggle("hidden", mode === "login");
  $("#authSubmit").textContent = mode === "login" ? "Kirish" : "Parolni saqlash va kirish";
  $("#authErr").classList.add("hidden");
}
$$(".auth-tab").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#authUser").value.trim();
  const password = $("#authPass").value;
  const err = $("#authErr");
  err.classList.add("hidden");
  try {
    if (state.authMode === "register") {
      if (password !== $("#authPass2").value) throw new Error("Parollar mos emas");
      await api("/api/register", "POST", { username, password });
      toast("Xush kelibsiz! Parolingiz saqlandi");
    } else {
      await api("/api/login", "POST", { username, password });
      toast("Tizimga kirdingiz");
    }
    closeModals();
    await loadMe();
    hideGate();
    renderProfile();
    renderCart();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

function renderProfile() {
  const body = $("#profileBody");
  if (!state.user) { openAuth("login"); return; }
  body.innerHTML = `
    <div class="profile-info">
      <div class="u">@${state.user.username}</div>
      <div class="muted small">${state.user.is_admin ? "Administrator" : "Oddiy foydalanuvchi"}</div>
      ${state.user.google_email ? `<div class="gchip">G · ${state.user.google_name || ""} · ${state.user.google_email}</div>` : ""}
    </div>
    ${state.user.is_admin ? '<button class="btn ghost full" onclick="location.href=\'/admin\'">🛠 Admin panel</button>' : ""}
    <button class="btn danger full" id="logoutBtn" style="margin-top:10px">Chiqish</button>`;
  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", "POST");
    state.user = null;
    state.addresses = [];
    closeModals();
    showGate();
    toast("Chiqdingiz");
    renderCart();
  });
}

async function loadMe() {
  try { const d = await api("/api/me"); state.user = d.user; } catch { state.user = null; }
}

function needAuth() {
  if (state.user) return true;
  openAuth("login");
  toast("Davom etish uchun tizimga kiring", true);
  return false;
}

/* ================= DO'KON ================= */
async function loadShop() {
  const [c, p] = await Promise.all([api("/api/categories"), api("/api/products")]);
  state.cats = c.categories;
  state.products = p.products;
  renderCats();
  renderProducts();
}
function renderCats() {
  $("#cats").innerHTML =
    `<div class="cat ${state.cat === 0 ? "active" : ""}" data-cat="0"><span class="e">🛒</span><span class="n">Barchasi</span></div>` +
    state.cats.map((c) => `
      <div class="cat ${state.cat === c.id ? "active" : ""}" data-cat="${c.id}">
        <span class="e">${c.emoji}</span><span class="n">${c.name}</span>
      </div>`).join("");
  $$("#cats .cat").forEach((el) =>
    el.addEventListener("click", () => { state.cat = Number(el.dataset.cat); renderCats(); renderProducts(); })
  );
}
function renderProducts() {
  let list = state.products.filter((p) => !state.cat || p.category_id === state.cat);
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter((p) => (p.name + " " + p.category).toLowerCase().includes(q));
  }
  $("#products").innerHTML = list.length ? list.map((p) => `
    <div class="prod">
      <div class="img">${p.emoji}</div>
      <div class="body">
        <div class="name">${p.name}</div>
        <div class="price">${fmt(p.price)}</div>
        <div class="stock">${p.qty > 0 ? `✅ ${p.warehouses} ta omborda mavjud` : "❌ Omborda yo'q"}</div>
        ${p.qty > 0 ? `<div class="delivery">🚚 Yetkazish: <b>${p.delivery}</b></div>` : ""}
        <button class="btn primary" data-add="${p.id}" ${p.qty > 0 ? "" : "disabled"}>Savatga</button>
      </div>
    </div>`).join("") : `<p class="empty">Tovar topilmadi</p>`;
  $$("#products [data-add]").forEach((b) =>
    b.addEventListener("click", () => addToCart("market", Number(b.dataset.add)))
  );
}
$("#search").addEventListener("input", (e) => { state.q = e.target.value.trim(); renderProducts(); });

function addToCart(kind, id) {
  const src = kind === "market"
    ? state.products.find((p) => p.id === id)
    : state.food.flatMap((f) => f.items).find((f) => f.id === id);
  if (!src) return;
  const found = state.cart.find((i) => i.kind === kind && i.id === id);
  if (found) found.qty++;
  else state.cart.push({ kind, id, name: src.name, price: src.price, emoji: src.emoji, qty: 1 });
  saveCart();
  toast(`«${src.name}» savatga qo'shildi`);
}

/* ================= TAOM ================= */
async function loadFood() {
  const d = await api("/api/food");
  state.food = d.places;
  $("#places").innerHTML = state.food.map((p) => `
    <div class="place">
      <div class="place-head">
        <div class="e">${p.emoji}</div>
        <div>
          <h3>${p.name}</h3>
          <div class="meta">⭐ ${p.rating} · 🕒 ${p.delivery_min} daqiqa</div>
        </div>
      </div>
      <div class="food-items">
        ${p.items.map((i) => `
          <div class="food-item">
            <div class="e">${i.emoji}</div>
            <div class="n">${i.name}</div>
            <div class="price" style="color:var(--purple);font-weight:800">${fmt(i.price)}</div>
            <button class="btn ghost" data-food="${i.id}">Savatga</button>
          </div>`).join("")}
      </div>
    </div>`).join("");
  $$("#places [data-food]").forEach((b) =>
    b.addEventListener("click", () => addToCart("food", Number(b.dataset.food)))
  );
}

/* ================= TAKSI ================= */
async function loadTaxiClasses() {
  const d = await api("/api/taxi/classes");
  state.classes = d.classes;
  renderClasses();
}
function renderClasses() {
  $("#txClasses").innerHTML = state.classes.map((c) => `
    <div class="class-card ${state.txClass === c.key ? "active" : ""}" data-cls="${c.key}">
      <div class="e">${c.emoji}</div>
      <div class="n">${c.name}</div>
      <div class="p">boshlanishi ${fmt(c.base)}</div>
    </div>`).join("");
  $$("#txClasses .class-card").forEach((el) =>
    el.addEventListener("click", () => { state.txClass = el.dataset.cls; renderClasses(); estimateTaxi(); })
  );
}
async function estimateTaxi() {
  const from = $("#txFrom").value.trim(), to = $("#txTo").value.trim();
  const box = $("#txEstimate");
  if (!from || !to) { box.classList.add("hidden"); return; }
  try {
    const r = await api("/api/taxi/estimate", "POST", { from, to, car_class: state.txClass });
    box.classList.remove("hidden");
    box.innerHTML = `Taxminiy narx: <b>${fmt(r.price)}</b><br><span class="muted small">${r.km} km · ${r.class.name}</span>`;
  } catch { box.classList.add("hidden"); }
}
["#txFrom", "#txTo"].forEach((s) => $(s).addEventListener("input", estimateTaxi));

$("#txCall").addEventListener("click", async () => {
  if (!needAuth()) return;
  try {
    const r = await api("/api/taxi", "POST", {
      from: $("#txFrom").value.trim(), to: $("#txTo").value.trim(), car_class: state.txClass,
    });
    toast(`Haydachi keldi: ${r.driver} · ${fmt(r.price)}`);
    $("#txFrom").value = ""; $("#txTo").value = "";
    $("#txEstimate").classList.add("hidden");
    renderTaxi();
  } catch (ex) { toast(ex.message, true); }
});

async function renderTaxi() {
  if (!state.user) {
    $("#taxiOrders").innerHTML = `<div class="card"><p class="empty">Buyurtmalarni ko'rish uchun tizimga kiring 👤</p></div>`;
    return;
  }
  try {
    const d = await api("/api/taxi");
    state.taxiOrders = d.orders;
  } catch { return; }
  $("#taxiOrders").innerHTML = `
    <div class="card"><h3>🧾 Mening taksi buyurtmalarim</h3>
      ${state.taxiOrders.length ? state.taxiOrders.map((o) => `
        <div class="ride">
          <div class="route">${o.from_addr} ➜ ${o.to_addr}</div>
          <div class="meta">${o.class.emoji} ${o.class.name} · ${fmt(o.price)} · Haydachi: ${o.driver} · ${o.created_at}</div>
          <div class="row">
            <span class="status ${o.status.includes("bekor") ? "cancel" : o.status === "yakunlandi" ? "done" : ""}">${o.status}</span>
            ${["yangi", "keldi"].includes(o.status) ? `<button class="btn danger" data-txcancel="${o.id}">Bekor qilish</button>` : ""}
          </div>
        </div>`).join("") : '<p class="empty">Hozircha buyurtma yo\'q</p>'}
    </div>`;
  $$("#taxiOrders [data-txcancel]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await api(`/api/taxi/${b.dataset.txcancel}/cancel`, "POST"); toast("Taksi buyurtmasi bekor qilindi"); renderTaxi(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
}

/* ================= SAVAT + MANZIL + BUYURTMA ================= */
function cartBy(kind) { return state.cart.filter((i) => i.kind === kind); }
function cartTotal() { return state.cart.reduce((s, i) => s + i.price * i.qty, 0); }

function cartDelivery() {
  const parts = [];
  let min = 99, max = 0;
  cartBy("market").forEach((i) => {
    const p = state.products.find((x) => x.id === i.id);
    const m = p && p.delivery && p.delivery.match(/(\d+)-(\d+)/);
    if (m) { min = Math.min(min, Number(m[1])); max = Math.max(max, Number(m[2])); }
  });
  if (max) parts.push(`🛍️ Tovarlar: <b>${min}-${max} kun</b>`);
  if (cartBy("food").length) parts.push(`🍔 Taomlar: <b>30-45 daqiqa</b>`);
  return parts.join(" &nbsp;•&nbsp; ");
}

function renderCart() {
  const box = $("#cartItems");
  if (!state.cart.length) {
    box.innerHTML = `<p class="empty">Savat bo'sh 🛒<br><span class="small">Do'kon yoki Taom bo'limidan mahsulot qo'shing</span></p>`;
  } else {
    box.innerHTML = state.cart.map((i, idx) => `
      <div class="cart-line">
        <div class="e">${i.emoji}</div>
        <div class="info">
          <div class="n">${i.name}</div>
          <div class="p">${fmt(i.price * i.qty)}</div>
          <div class="small muted">${i.kind === "food" ? "🍔 Taom" : "🛍️ Tovar"}</div>
        </div>
        <div class="qty">
          <button data-dec="${idx}">−</button><span>${i.qty}</span><button data-inc="${idx}">+</button>
        </div>
        <button class="btn danger" data-del="${idx}" style="padding:6px 9px">🗑</button>
      </div>`).join("");
    $$("#cartItems [data-inc]").forEach((b) => b.addEventListener("click", () => { state.cart[+b.dataset.inc].qty++; saveCart(); renderCart(); }));
    $$("#cartItems [data-dec]").forEach((b) => b.addEventListener("click", () => {
      const i = state.cart[+b.dataset.dec];
      i.qty--; if (i.qty <= 0) state.cart.splice(+b.dataset.dec, 1);
      saveCart(); renderCart();
    }));
    $$("#cartItems [data-del]").forEach((b) => b.addEventListener("click", () => { state.cart.splice(+b.dataset.del, 1); saveCart(); renderCart(); }));
  }
  $("#totalCard").classList.toggle("hidden", !state.cart.length);
  $("#totalSum").textContent = fmt(cartTotal());
  const est = $("#deliveryEst");
  const d = cartDelivery();
  est.classList.toggle("hidden", !d);
  est.innerHTML = d ? `🚚 Yetkazib berish: ${d}` : "";
  renderAddresses();
  renderOrders();
}

async function renderAddresses() {
  const box = $("#addrList");
  if (!state.user) { box.innerHTML = `<p class="empty">Manzilni belgilash uchun tizimga kiring 👤</p>`; return; }
  try { state.addresses = (await api("/api/addresses")).addresses; } catch { return; }
  if (!state.addresses.length) { box.innerHTML = `<p class="empty">Manzil hali yo'q — quyida qo'shing</p>`; return; }
  if (!state.addresses.find((a) => a.id === state.selectedAddr)) state.selectedAddr = state.addresses[0].id;
  box.innerHTML = state.addresses.map((a) => `
    <div class="addr ${state.selectedAddr === a.id ? "active" : ""}" data-addr="${a.id}">
      <div><div class="t">${a.title}</div><div class="a">${a.text}${a.phone ? " · " + a.phone : ""}</div></div>
      <button class="del" data-deladdr="${a.id}" title="O'chirish">🗑</button>
    </div>`).join("");
  $$("#addrList [data-addr]").forEach((el) =>
    el.addEventListener("click", (e) => {
      if (e.target.dataset.deladdr) return;
      state.selectedAddr = Number(el.dataset.addr);
      localStorage.setItem("bz_addr", state.selectedAddr);
      renderAddresses();
      toast("Manzil tanlandi");
    })
  );
  $$("#addrList [data-deladdr]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api("/api/addresses/" + b.dataset.deladdr, "DELETE");
      if (state.selectedAddr === Number(b.dataset.deladdr)) state.selectedAddr = 0;
      renderAddresses();
    })
  );
}

$("#addAddrBtn").addEventListener("click", () => {
  if (!needAuth()) return;
  $("#addrErr").classList.add("hidden");
  openModal("#addrModal");
});
$("#addrForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const d = await api("/api/addresses", "POST", {
      title: $("#addrTitle").value.trim(), text: $("#addrText").value.trim(), phone: $("#addrPhone").value.trim(),
    });
    state.selectedAddr = d.id;
    localStorage.setItem("bz_addr", d.id);
    $("#addrForm").reset();
    closeModals();
    toast("Manzil saqlandi");
    renderAddresses();
  } catch (ex) {
    $("#addrErr").textContent = ex.message;
    $("#addrErr").classList.remove("hidden");
  }
});

$("#checkoutBtn").addEventListener("click", async () => {
  if (!needAuth()) return;
  if (!state.cart.length) return toast("Savat bo'sh", true);
  if (!state.selectedAddr || !state.addresses.find((a) => a.id === state.selectedAddr)) {
    $("#addrCard").scrollIntoView({ behavior: "smooth" });
    return toast("Avval savatda manzilingizni belgilang", true);
  }
  const btn = $("#checkoutBtn");
  btn.disabled = true;
  try {
    const market = cartBy("market"), food = cartBy("food");
    const results = [];
    if (market.length) {
      const d = await api("/api/orders", "POST", {
        items: market.map((i) => ({ id: i.id, qty: i.qty })), address_id: state.selectedAddr,
      });
      results.push(`Tovar buyurtmasi #${d.id} · yetkazish ${d.delivery} · omborlar: ${d.warehouses.map((w) => w.name).join(", ")}`);
      d.warehouses.forEach((w) => {});
    }
    if (food.length) {
      const d = await api("/api/food-orders", "POST", {
        items: food.map((i) => ({ id: i.id, qty: i.qty })), address_id: state.selectedAddr,
      });
      results.push(`Taom buyurtmasi #${d.id} · yetkazish ~35 daqiqa`);
    }
    state.cart = [];
    saveCart();
    renderCart();
    toast("Buyurtma qabul qilindi! ✅ " + results.join(" | "));
  } catch (ex) {
    toast(ex.message, true);
  } finally {
    btn.disabled = false;
  }
});

async function renderOrders() {
  const box = $("#myOrders");
  if (!state.user) { box.innerHTML = `<p class="empty">Buyurtmalarni ko'rish uchun tizimga kiring 👤</p>`; return; }
  try { state.orders = (await api("/api/orders")).orders; } catch { return; }
  if (!state.orders.length) { box.innerHTML = `<p class="empty">Buyurtmalar yo'q</p>`; return; }
  box.innerHTML = state.orders.map((o) => `
    <div class="order">
      <div class="head">
        <b>#${o.id} · ${o.type === "food" ? "🍔 Taom" : "🛍️ Tovar"} · ${fmt(o.total)}</b>
        <span class="status ${o.status.includes("bekor") ? "cancel" : o.status === "yetkazildi" ? "done" : ""}">${o.status}</span>
      </div>
      <div class="items">${o.items.map((i) => `${i.emoji} ${i.name} ×${i.qty}`).join(" · ")}</div>
      <div class="items">📍 ${o.address_text}</div>
      <div class="items">🚚 Yetkazib berish: <b>${o.delivery || (o.type === "food" ? "30-45 daqiqa" : "3-5 kun")}</b></div>
      ${o.warehouses.length ? `<div class="wh">🏬 Omborlar: ${o.warehouses.map((w) => `${w.name} (${w.count} dona)`).join(" · ")}</div>` : ""}
      <div class="actions">
        ${["yangi", "tasdiqlandi"].includes(o.status) ? `<button class="btn danger" data-cancel="${o.id}">❌ Bekor qilish</button>` : ""}
      </div>
    </div>`).join("");
  $$("#myOrders [data-cancel]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Buyurtmani bekor qilasizmi?")) return;
      try {
        await api(`/api/orders/${b.dataset.cancel}/cancel`, "POST");
        toast("Buyurtma bekor qilindi — omborga qaytarildi");
        renderOrders();
      } catch (ex) { toast(ex.message, true); }
    })
  );
}

/* ================= BOSHLANG'ICH YUKLASH ================= */
(async function init() {
  saveCart();
  let gId = "";
  const cfgP = api("/api/config").then((d) => (gId = d.google_client_id || "")).catch(() => {});
  await Promise.all([loadMe(), loadShop(), loadFood(), loadTaxiClasses(), cfgP]);
  if (gId) await initGoogle(gId);
  if (state.user) hideGate();
  else showGate();
  renderCart();
  switchTab("shop");
})();
