async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Xatolik"), { status: res.status });
  return data;
}
const fmt = (n) => Number(n || 0).toLocaleString("uz-UZ") + " so'm";
const STATUS_UZ = { checking: "Tekshirilmoqda", pending: "Kutilmoqda", processing: "Jarayonda", done: "Tasdiqlandi", cancelled: "Rad etildi" };
