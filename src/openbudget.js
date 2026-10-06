const https = require("https");

const API_HOST = "api.openbudget.uz";

function apiRequest(pathname, apiKey) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: API_HOST, path: pathname, method: "GET", timeout: 8000, headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: JSON.parse(body || "{}") });
          } catch {
            resolve({ ok: false, status: res.statusCode, data: null });
          }
        });
      }
    );
    req.on("error", () => resolve({ ok: false, status: 0, data: null }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, status: 0, data: null }); });
    req.end();
  });
}

async function verifyOpenBudgetId(obId, apiKey) {
  const clean = String(obId || "").trim();
  if (!/^\d{4,20}$/.test(clean)) return { ok: false, reason: "format" };
  const attempts = [`/v1/users/${clean}`, `/api/v1/check-id?id=${encodeURIComponent(clean)}`];
  for (const p of attempts) {
    const r = await apiRequest(p, apiKey);
    if (r.ok && r.data) return { ok: true, data: r.data };
    if (r.status === 404) return { ok: false, reason: "notfound" };
  }
  return { ok: true, unchecked: true };
}

module.exports = { verifyOpenBudgetId };
