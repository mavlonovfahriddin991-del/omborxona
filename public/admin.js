const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function guard() {
  try {
    await api("/api/me");
  } catch {
    location.href = "/login";
  }
}

document.querySelectorAll(".sidebar button[data-view]").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".sidebar button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll("main section").forEach((s) => (s.style.display = "none"));
    $("view-" + btn.dataset.view).style.display = "";
    views[btn.dataset.view]?.();
  };
});

$("logout").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/login";
};

const views = {};

views.stats = async () => {
  const s = await api("/api/admin/stats");
  const cards = [
    ["Foydalanuvchilar", s.users],
    ["Bugun qo'shilgan", s.new_users_today],
    ["Ovozlar (jami)", s.orders_total],
    ["Tekshiruvda", s.orders_checking],
    ["Tasdiqlangan", s.orders_done],
    ["To'langan mukofotlar", fmt(s.revenue)],
    ["Foydalanuvchi balanslari", fmt(s.balances)],
  ];
  $("stat-cards").innerHTML = cards
    .map(([l, v]) => `<div class="stat-card"><div class="num">${esc(v)}</div><div class="lbl">${esc(l)}</div></div>`)
    .join("");
};

views.orders = async () => {
  const status = $("order-filter").value;
  const { orders } = await api("/api/admin/orders" + (status ? `?status=${status}` : ""));
  $("orders-table").innerHTML =
    "<tr><th>ID</th><th>Mijoz</th><th>OB ID</th><th>Mukofot</th><th>Skrinshot</th><th>Sana</th><th>Holat</th></tr>" +
    orders
      .map(
        (o) => `<tr>
          <td>#${o.id}</td><td>${esc(o.username)}</td>
          <td><b style="color:#4ade80">${esc(o.ob_id || "-")}</b></td>
          <td>${fmt(o.amount)}</td>
          <td>${o.proof_image ? `<a href="${esc(o.proof_image)}" target="_blank"><img src="${esc(o.proof_image)}" style="max-height:56px;border-radius:6px" /></a>` : "-"}</td>
          <td>${o.created_at.slice(0, 16)}</td>
          <td>
            ${o.status === "checking" ? `<button class="btn-mini act-ok" data-id="${o.id}">✓ Tasdiq</button> <button class="btn-mini act-no" data-id="${o.id}" style="color:#f87171">✗ Rad</button>` : ""}
            <select class="status-sel" data-id="${o.id}">
              ${["checking", "done", "cancelled"]
                .map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${STATUS_UZ[s]}</option>`)
                .join("")}
            </select>
          </td>
        </tr>`
      )
      .join("");
  document.querySelectorAll("#orders-table .act-ok").forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/admin/orders/${b.dataset.id}/status`, { method: "PUT", body: { status: "done" } });
        views.orders();
      } catch (e) {
        alert(e.message);
      }
    };
  });
  document.querySelectorAll("#orders-table .act-no").forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/admin/orders/${b.dataset.id}/status`, { method: "PUT", body: { status: "cancelled" } });
        views.orders();
      } catch (e) {
        alert(e.message);
      }
    };
  });
  document.querySelectorAll("#orders-table .status-sel").forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api(`/api/admin/orders/${sel.dataset.id}/status`, { method: "PUT", body: { status: sel.value } });
      } catch (e) {
        alert(e.message);
        views.orders();
      }
    };
  });
};
$("order-filter").onchange = views.orders;

views.users = async () => {
  const q = $("user-search").value.trim();
  const { users } = await api("/api/admin/users" + (q ? `?q=${encodeURIComponent(q)}` : ""));
  $("users-table").innerHTML =
    "<tr><th>ID</th><th>Login</th><th>Telegram</th><th>Balans</th><th>Ref kod</th><th>Admin</th><th>Holat</th><th>Balans ±</th></tr>" +
    users
      .map(
        (u) => `<tr data-id="${u.id}">
          <td>${u.id}</td><td>${esc(u.username)}</td><td>${esc(u.telegram_username || "-")}</td>
          <td class="bal">${fmt(u.balance)}</td><td>${esc(u.ref_code)}</td>
          <td><button class="btn-mini act-admin">${u.is_admin ? "✓ Admin" : "Oddiy"}</button></td>
          <td><button class="btn-mini act-ban">${u.banned ? "🔴 Bloklangan" : "🟢 Faol"}</button></td>
          <td style="white-space:normal">
            <input class="inp" type="number" style="width:110px" placeholder="+/- so'm" />
            <button class="btn-mini act-bal">OK</button>
          </td>
        </tr>`
      )
      .join("");
  document.querySelectorAll("#users-table tr[data-id]").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".act-bal").onclick = async () => {
      const delta = Number(row.querySelector("input[type=number]").value);
      if (!delta) return;
      try {
        await api(`/api/admin/users/${id}`, { method: "PUT", body: { balance_delta: delta } });
        const u = users.find((x) => x.id == id);
        u.balance += delta;
        row.querySelector(".bal").textContent = fmt(u.balance);
        row.querySelector("input[type=number]").value = "";
      } catch (e) {
        alert(e.message);
      }
    };
    row.querySelector(".act-ban").onclick = async () => {
      const u = users.find((x) => x.id == id);
      try {
        await api(`/api/admin/users/${id}`, { method: "PUT", body: { banned: !u.banned } });
        u.banned = !u.banned;
        row.querySelector(".act-ban").textContent = u.banned ? "🔴 Bloklangan" : "🟢 Faol";
      } catch (e) {
        alert(e.message);
      }
    };
    row.querySelector(".act-admin").onclick = async () => {
      const u = users.find((x) => x.id == id);
      try {
        await api(`/api/admin/users/${id}`, { method: "PUT", body: { is_admin: !u.is_admin } });
        u.is_admin = !u.is_admin;
        row.querySelector(".act-admin").textContent = u.is_admin ? "✓ Admin" : "Oddiy";
      } catch (e) {
        alert(e.message);
      }
    };
  });
};
let searchTimer;
$("user-search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(views.users, 350);
};

views.services = async () => {
  const { services } = await api("/api/admin/services");
  $("services-table").innerHTML =
    "<tr><th>ID</th><th>Nomi</th><th>Narx</th><th>Turi</th><th>Faol</th><th>Amal</th></tr>" +
    services
      .map(
        (s) => `<tr data-id="${s.id}">
          <td>${s.id}</td>
          <td><input class="inp svc-name" value="${esc(s.name)}" /></td>
          <td><input class="inp svc-price" type="number" min="0" value="${s.price}" style="width:120px" /></td>
          <td>${s.kind === "id" ? "OpenBudget ID" : "Xizmat"}</td>
          <td><button class="btn-mini act-on">${s.active ? "✓ Faol" : "O'chirilgan"}</button></td>
          <td>${s.kind === "id" ? "" : '<button class="btn-mini act-del">🗑 O\'chirish</button>'}</td>
        </tr>`
      )
      .join("");
  document.querySelectorAll("#services-table tr[data-id]").forEach((row) => {
    const id = row.dataset.id;
    const s = services.find((x) => x.id == id);
    row.querySelector(".act-on").onclick = async () => {
      await api(`/api/admin/services/${id}`, { method: "PUT", body: { active: !s.active } });
      s.active = !s.active;
      row.querySelector(".act-on").textContent = s.active ? "✓ Faol" : "O'chirilgan";
    };
    row.querySelector(".svc-name").onchange = (e) =>
      api(`/api/admin/services/${id}`, { method: "PUT", body: { name: e.target.value } });
    row.querySelector(".svc-price").onchange = (e) =>
      api(`/api/admin/services/${id}`, { method: "PUT", body: { price: Number(e.target.value) } }).then(() =>
        api("/api/admin/settings")
      );
    const del = row.querySelector(".act-del");
    if (del)
      del.onclick = async () => {
        if (!confirm("O'chirilsinmi?")) return;
        await api(`/api/admin/services/${id}`, { method: "DELETE" });
        views.services();
      };
  });
};

$("add-svc").onclick = async () => {
  try {
    await api("/api/admin/services", { method: "POST", body: { name: $("svc-name").value.trim(), price: Number($("svc-price").value) } });
    $("svc-name").value = "";
    $("svc-price").value = "";
    views.services();
  } catch (e) {
    alert(e.message);
  }
};

views.settings = async () => {
  const s = await api("/api/admin/settings");
  $("set-target-id").value = s.target_ob_id || "";
  $("set-vote-reward").value = s.vote_reward;
  $("set-ref-reward").value = s.ref_reward;
};

$("save-settings").onclick = async () => {
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      body: {
        target_ob_id: $("set-target-id").value.trim(),
        vote_reward: Number($("set-vote-reward").value),
        ref_reward: Number($("set-ref-reward").value),
      },
    });
    alert("Saqlandi ✅");
  } catch (e) {
    alert(e.message);
  }
};

views.transactions = async () => {
  const { transactions } = await api("/api/admin/transactions");
  $("tx-table").innerHTML =
    "<tr><th>ID</th><th>Foydalanuvchi</th><th>Summa</th><th>Tur</th><th>Izoh</th><th>Sana</th></tr>" +
    transactions
      .map(
        (t) => `<tr>
          <td>${t.id}</td><td>${esc(t.username)}</td>
          <td style="color:${t.amount >= 0 ? "#4ade80" : "#f87171"}">${t.amount >= 0 ? "+" : ""}${fmt(t.amount)}</td>
          <td>${esc(t.type)}</td><td>${esc(t.note || "")}</td><td>${t.created_at.slice(0, 16)}</td>
        </tr>`
      )
      .join("");
};

guard().then(() => views.stats());
