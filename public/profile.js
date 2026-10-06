(async () => {
  const $ = (id) => document.getElementById(id);
  let me;
  try {
    me = (await api("/api/me")).user;
  } catch {
    location.href = "/login";
    return;
  }
  $("username").textContent = me.username;
  $("balance").textContent = fmt(me.balance);

  try {
    const r = await api("/api/referral");
    $("ref-link").textContent = r.link;
    $("invited").textContent = r.invited;
    $("earned").textContent = fmt(r.earned);
  } catch {}

  $("copy-btn").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("ref-link").textContent);
      $("copy-btn").textContent = "✅ Nusxalandi";
      setTimeout(() => ($("copy-btn").textContent = "📋 Nusxa olish"), 1500);
    } catch {}
  };

  $("logout-btn").onclick = async () => {
    await api("/api/logout", { method: "POST" });
    location.href = "/login";
  };
})();
