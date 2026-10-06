const $ = (id) => document.getElementById(id);
function showMsg(text, ok = false) {
  const m = $("msg");
  m.textContent = text;
  m.className = "msg " + (ok ? "ok" : "err");
}

function setTab(login) {
  $("tab-login").classList.toggle("active", login);
  $("tab-reg").classList.toggle("active", !login);
  $("form-login").style.display = login ? "" : "none";
  $("form-reg").style.display = login ? "none" : "";
}
$("tab-login").onclick = () => setTab(true);
$("tab-reg").onclick = () => setTab(false);

const urlRef = new URLSearchParams(location.search).get("ref");
if (urlRef) {
  sessionStorage.setItem("refCode", urlRef.toUpperCase());
  $("rg-ref").value = urlRef.toUpperCase();
} else if (sessionStorage.getItem("refCode")) {
  $("rg-ref").value = sessionStorage.getItem("refCode");
}

function go(r) {
  location.href = r.redirect || "/";
}

$("btn-login").onclick = async () => {
  try {
    const r = await api("/api/login", { method: "POST", body: { username: $("li-user").value, password: $("li-pass").value } });
    go(r);
  } catch (e) {
    showMsg(e.message);
  }
};

$("btn-reg").onclick = async () => {
  try {
    const r = await api("/api/register", {
      method: "POST",
      body: { username: $("rg-user").value, password: $("rg-pass").value, ref: $("rg-ref").value.trim() },
    });
    sessionStorage.removeItem("refCode");
    go(r);
  } catch (e) {
    showMsg(e.message);
  }
};
