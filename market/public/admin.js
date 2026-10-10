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
  if (!res.ok) throw new Error(data.error || "Xatolik");
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

$$("#anav button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#anav button").forEach((x) => x.classList.toggle("active", x === b));
    ["stats", "us", "wh", "pr", "cat", "or", "fd", "tx"].forEach((p) => $("#p-" + p).classList.add("hidden"));
    $("#p-" + b.dataset.p).classList.remove("hidden");
    load(b.dataset.p);
  })
);

async function load(part) {
  try {
    if (part === "stats") return await loadStats();
    if (part === "us") return await loadUs();
    if (part === "wh") return await loadWh();
    if (part === "pr") return await loadPr();
    if (part === "cat") return await loadCat();
    if (part === "or") return await loadOr();
    if (part === "fd") return await loadFd();
    if (part === "tx") return await loadTx();
  } catch (ex) {
    toast(ex.message, true);
    if (String(ex.message).includes("Ruxsat")) showDenied();
  }
}

function showDenied() {
  $("#denied").classList.remove("hidden");
  $("#anav").classList.add("hidden");
  ["stats", "us", "wh", "pr", "cat", "or", "fd", "tx"].forEach((p) => $("#p-" + p).classList.add("hidden"));
}

async function loadStats() {
  const s = await api("/api/admin/overview");
  $("#stats").innerHTML = `
    <div class="stat"><b>${s.users}</b><span>Foydalanuvchi</span></div>
    <div class="stat"><b>${s.orders}</b><span>Buyurtma</span></div>
    <div class="stat"><b>${s.cancelled}</b><span>Bekor qilingan</span></div>
    <div class="stat"><b>${fmt(s.revenue)}</b><span>Dumoloq</span></div>
    <div class="stat"><b>${s.taxi}</b><span>Taksi</span></div>
    <div class="stat"><b>${s.products}</b><span>Tovar</span></div>
    <div class="stat"><b>${s.warehouses}</b><span>Ombor</span></div>`;
}

async function loadWh() {
  const d = await api("/api/admin/warehouses");
  $("#whList").innerHTML = `
    <table><tr><th>#</th><th>Nomi</th><th>Manzil</th><th>Shahar</th><th>Mahsulot</th></tr>
    ${d.warehouses.map((w) => `<tr><td>${w.id}</td><td>${w.name}</td><td>${w.address}</td><td>${w.city}</td><td>${w.items} dona</td></tr>`).join("")}
    </table>`;
}
$("#whAdd").addEventListener("click", async () => {
  try {
    await api("/api/admin/warehouses", "POST", { name: $("#whName").value, address: $("#whAddr").value, city: "Toshkent" });
    $("#whName").value = ""; $("#whAddr").value = "";
    toast("Ombor qo'shildi");
    loadWh();
  } catch (ex) { toast(ex.message, true); }
});

let PR = null;
async function loadPr() {
  PR = await api("/api/admin/products");
  $("#prCat").innerHTML = PR.categories.map((c) => `<option value="${c.id}">${c.emoji} ${c.name}</option>`).join("");
  $("#prWh").innerHTML = `<option value="0">— omborsiz —</option>` + PR.warehouses.map((w) => `<option value="${w.id}">${w.name}</option>`).join("");
  $("#prList").innerHTML = `
    <div style="overflow-x:auto"><table>
      <tr><th>#</th><th>Tovar</th><th>Kategoriya</th><th>Narx</th><th>Soni</th><th>Holat</th><th>Omborga qo'shish</th></tr>
      ${PR.products.map((p) => `
        <tr>
          <td>${p.id}</td>
          <td>${p.emoji} ${p.name}</td>
          <td>${p.category}</td>
          <td>${fmt(p.price)}</td>
          <td>${p.qty}</td>
          <td>
            <select data-toggle="${p.id}">
              <option value="1" ${p.active ? "selected" : ""}>Faol</option>
              <option value="0" ${p.active ? "" : "selected"}>O'chiq</option>
            </select>
          </td>
          <td>
            <select data-stockwh="${p.id}">
              ${PR.warehouses.map((w) => `<option value="${w.id}">${w.name}</option>`).join("")}
            </select>
            <input type="text" data-stockqty="${p.id}" placeholder="dona" style="width:70px;padding:6px">
            <button class="btn ghost" data-stockbtn="${p.id}" style="padding:6px 9px">💾</button>
          </td>
        </tr>`).join("")}
    </table></div>`;
  $$("#prList [data-toggle]").forEach((s) =>
    s.addEventListener("change", async () => {
      try { await api("/api/admin/products/" + s.dataset.toggle, "PUT", { active: s.value === "1" }); toast("Yangilandi"); }
      catch (ex) { toast(ex.message, true); }
    })
  );
  $$("#prList [data-stockbtn]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.stockbtn;
      const wh = $(`[data-stockwh="${id}"]`).value;
      const qty = $(`[data-stockqty="${id}"]`).value;
      try {
        await api(`/api/admin/products/${id}/stock`, "PUT", { warehouse_id: Number(wh), qty: Number(qty) });
        toast("Ombor zaxirasi yangilandi");
        loadPr();
      } catch (ex) { toast(ex.message, true); }
    })
  );
}
$("#prAdd").addEventListener("click", async () => {
  try {
    await api("/api/admin/products", "POST", {
      category_id: Number($("#prCat").value), name: $("#prName").value, price: Number($("#prPrice").value),
      emoji: $("#prEmoji").value || "📦", warehouse_id: Number($("#prWh").value), qty: Number($("#prQty").value || 0),
    });
    ["#prName", "#prPrice", "#prEmoji", "#prQty"].forEach((s) => ($(s).value = ""));
    toast("Tovar qo'shildi");
    loadPr();
  } catch (ex) { toast(ex.message, true); }
});

async function loadOr() {
  const d = await api("/api/admin/orders");
  $("#orList").innerHTML = d.orders.length ? `
    <div style="overflow-x:auto"><table>
      <tr><th>#</th><th>Mijoz</th><th>Turi</th><th>Mahsulotlar</th><th>Manzil</th><th>Jami</th><th>Yetkazish</th><th>Holat</th></tr>
      ${d.orders.map((o) => `
        <tr>
          <td>${o.id}</td><td>${o.username}</td>
          <td>${o.type === "food" ? "🍔 Taom" : "🛍️ Tovar"}</td>
          <td>${o.items.map((i) => `${i.name}×${i.qty}`).join(", ")}</td>
          <td>${o.address_text}</td>
          <td>${fmt(o.total)}</td>
          <td>🚚 ${o.delivery || "3-5 kun"}</td>
          <td>
            <select data-ost="${o.id}">
              ${d.statuses.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
            </select>
            ${["yangi", "tasdiqlandi"].includes(o.status) ? `<button class="btn danger" data-ocancel="${o.id}" style="padding:5px 8px;font-size:11px">Bekor</button>` : ""}
          </td>
        </tr>`).join("")}
    </table></div>` : `<p class="empty">Buyurtma yo'q</p>`;
  $$("#orList [data-ost]").forEach((s) =>
    s.addEventListener("change", async () => {
      try { await api("/api/admin/orders/" + s.dataset.ost + "/status", "PUT", { status: s.value }); toast("Holat yangilandi"); loadOr(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
  $$("#orList [data-ocancel]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await api("/api/admin/orders/" + b.dataset.ocancel + "/status", "PUT", { status: "bekor qilindi" }); toast("Bekor qilindi"); loadOr(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
}

async function loadTx() {
  const d = await api("/api/admin/taxi");
  $("#txList").innerHTML = d.orders.length ? `
    <div style="overflow-x:auto"><table>
      <tr><th>#</th><th>Mijoz</th><th>Yo'nalish</th><th>Avto</th><th>Narx</th><th>Haydachi</th><th>Holat</th></tr>
      ${d.orders.map((o) => `
        <tr>
          <td>${o.id}</td><td>${o.username}</td>
          <td>${o.from_addr} ➜ ${o.to_addr}</td>
          <td>${o.class.emoji} ${o.class.name}</td>
          <td>${fmt(o.price)}</td><td>${o.driver}</td>
          <td><select data-tst="${o.id}">
            ${d.statuses.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
          </select></td>
        </tr>`).join("")}
    </table></div>` : `<p class="empty">Taksi buyurtma yo'q</p>`;
  $$("#txList [data-tst]").forEach((s) =>
    s.addEventListener("change", async () => {
      try { await api("/api/admin/taxi/" + s.dataset.tst + "/status", "PUT", { status: s.value }); toast("Yangilandi"); }
      catch (ex) { toast(ex.message, true); }
    })
  );
}

/* ---------- FOYDALANUVCHILAR ---------- */
async function loadUs() {
  const d = await api("/api/admin/users?q=" + encodeURIComponent($("#usQ").value.trim()));
  $("#usList").innerHTML = d.users.length ? `
    <div style="overflow-x:auto"><table>
      <tr><th>#</th><th>Login</th><th>Google</th><th>Buyurtma</th><th>Admin</th><th>Holat</th><th>Amal</th></tr>
      ${d.users.map((u) => `
        <tr>
          <td>${u.id}</td>
          <td>@${u.username}</td>
          <td>${u.google_email || "—"}</td>
          <td>${u.orders}</td>
          <td>${u.is_admin ? "✅" : "—"}</td>
          <td><span class="status ${u.banned ? "cancel" : "done"}">${u.banned ? "bloklangan" : "faol"}</span></td>
          <td>
            <button class="btn ghost" data-ua="${u.id}" data-v="${u.is_admin ? 0 : 1}" style="padding:5px 8px;font-size:11px">${u.is_admin ? "Adminlikni olish" : "Admin qilish"}</button>
            <button class="btn ${u.banned ? "ghost" : "danger"}" data-ub="${u.id}" data-v="${u.banned ? 0 : 1}" style="padding:5px 8px;font-size:11px">${u.banned ? "Blokdan chiqarish" : "Bloklash"}</button>
          </td>
        </tr>`).join("")}
    </table></div>` : `<p class="empty">Foydalanuvchi topilmadi</p>`;
  $$("#usList [data-ua]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await api("/api/admin/users/" + b.dataset.ua, "PUT", { is_admin: b.dataset.v === "1" }); toast("Yangilandi"); loadUs(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
  $$("#usList [data-ub]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await api("/api/admin/users/" + b.dataset.ub, "PUT", { banned: b.dataset.v === "1" }); toast("Yangilandi"); loadUs(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
}
let usTimer;
$("#usQ").addEventListener("input", () => { clearTimeout(usTimer); usTimer = setTimeout(loadUs, 300); });

/* ---------- KATEGORIYALAR ---------- */
async function loadCat() {
  const d = await api("/api/categories");
  const p = await api("/api/products");
  $("#catList").innerHTML = `
    <div style="overflow-x:auto"><table>
      <tr><th>#</th><th>Emoji</th><th>Nomi</th><th>Tovarlar</th><th>Amal</th></tr>
      ${d.categories.map((c) => {
        const count = p.products.filter((x) => x.category_id === c.id).length;
        return `<tr>
          <td>${c.id}</td>
          <td><input type="text" data-ce="${c.id}" value="${c.emoji}" style="width:55px;padding:6px"></td>
          <td><input type="text" data-cn="${c.id}" value="${c.name.replace(/"/g, "&quot;")}" style="width:180px;padding:6px"></td>
          <td>${count}</td>
          <td>
            <button class="btn ghost" data-cs="${c.id}" style="padding:5px 8px;font-size:11px">💾 Saqlash</button>
            <button class="btn danger" data-cd="${c.id}" style="padding:5px 8px;font-size:11px">O'chirish</button>
          </td>
        </tr>`;
      }).join("")}
    </table></div>`;
  $$("#catList [data-cs]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api("/api/admin/categories/" + b.dataset.cs, "PUT", {
          emoji: $(`[data-ce="${b.dataset.cs}"]`).value,
          name: $(`[data-cn="${b.dataset.cs}"]`).value,
        });
        toast("Kategoriya yangilandi"); loadCat();
      } catch (ex) { toast(ex.message, true); }
    })
  );
  $$("#catList [data-cd]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await api("/api/admin/categories/" + b.dataset.cd, "DELETE"); toast("O'chirildi"); loadCat(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
}
$("#catAdd").addEventListener("click", async () => {
  try {
    await api("/api/admin/categories", "POST", { name: $("#catName").value, emoji: $("#catEmoji").value || "🛒" });
    $("#catName").value = ""; $("#catEmoji").value = "";
    toast("Kategoriya qo'shildi"); loadCat();
  } catch (ex) { toast(ex.message, true); }
});

/* ---------- TAOMLAR ---------- */
async function loadFd() {
  const d = await api("/api/food");
  $("#fdPlace").innerHTML = d.places.map((p) => `<option value="${p.id}">${p.emoji} ${p.name}</option>`).join("");
  $("#fdList").innerHTML = d.places.map((p) => `
    <div class="order" style="margin-bottom:14px">
      <div class="head">
        <b>${p.emoji} ${p.name}</b>
        <button class="btn danger" data-pd="${p.id}" style="padding:5px 9px;font-size:11px">Restoranni o'chirish</button>
      </div>
      <div class="items">⭐ ${p.rating} · 🕒 ${p.delivery_min} daqiqa · ${p.items.length} ta taom</div>
      <div style="overflow-x:auto"><table>
        <tr><th>#</th><th>Taom</th><th>Narx</th><th>Faol</th><th>Amal</th></tr>
        ${p.items.map((i) => `
          <tr>
            <td>${i.id}</td>
            <td>${i.emoji} <input type="text" data-in="${i.id}" value="${i.name.replace(/"/g, "&quot;")}" style="width:150px;padding:6px"></td>
            <td><input type="text" data-ip="${i.id}" value="${i.price}" style="width:90px;padding:6px"></td>
            <td>
              <select data-ia="${i.id}">
                <option value="1" ${i.active ? "selected" : ""}>Ha</option>
                <option value="0" ${i.active ? "" : "selected"}>Yo'q</option>
              </select>
            </td>
            <td>
              <button class="btn ghost" data-is="${i.id}" style="padding:5px 8px;font-size:11px">💾</button>
              <button class="btn danger" data-idel="${i.id}" style="padding:5px 8px;font-size:11px">🗑</button>
            </td>
          </tr>`).join("")}
      </table></div>
    </div>`).join("") || `<p class="empty">Restoran yo'q</p>`;

  $$("#fdList [data-is]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api("/api/admin/food-items/" + b.dataset.is, "PUT", {
          name: $(`[data-in="${b.dataset.is}"]`).value,
          price: Number($(`[data-ip="${b.dataset.is}"]`).value),
          active: $(`[data-ia="${b.dataset.is}"]`).value === "1",
        });
        toast("Taom yangilandi"); loadFd();
      } catch (ex) { toast(ex.message, true); }
    })
  );
  $$("#fdList [data-idel]").forEach((b) =>
    b.addEventListener("click", async () => {
      try { await api("/api/admin/food-items/" + b.dataset.idel, "DELETE"); toast("Taom o'chirildi"); loadFd(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
  $$("#fdList [data-pd]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Restoran va barcha taomlari o'chiriladi. Davom etasizmi?")) return;
      try { await api("/api/admin/food-places/" + b.dataset.pd, "DELETE"); toast("Restoran o'chirildi"); loadFd(); }
      catch (ex) { toast(ex.message, true); }
    })
  );
}
$("#fdAdd").addEventListener("click", async () => {
  try {
    await api("/api/admin/food-places", "POST", {
      name: $("#fdName").value, emoji: $("#fdEmoji").value || "🍽️",
      rating: Number($("#fdRating").value) || 4.5, delivery_min: Number($("#fdMins").value) || 30,
    });
    ["#fdName", "#fdEmoji", "#fdRating", "#fdMins"].forEach((s) => ($(s).value = ""));
    toast("Restoran qo'shildi"); loadFd();
  } catch (ex) { toast(ex.message, true); }
});
$("#fdItemAdd").addEventListener("click", async () => {
  try {
    await api("/api/admin/food-items", "POST", {
      place_id: Number($("#fdPlace").value), name: $("#fdItemName").value,
      price: Number($("#fdItemPrice").value), emoji: $("#fdItemEmoji").value || "🍽️",
    });
    ["#fdItemName", "#fdItemPrice", "#fdItemEmoji"].forEach((s) => ($(s).value = ""));
    toast("Taom qo'shildi"); loadFd();
  } catch (ex) { toast(ex.message, true); }
});

/* ---------- BOSHLANG'ICH TEKSHIRUV ---------- */
(async function init() {
  try {
    const me = await api("/api/me");
    if (!me.user || !me.user.is_admin) return showDenied();
    loadStats();
  } catch {
    showDenied();
  }
})();
