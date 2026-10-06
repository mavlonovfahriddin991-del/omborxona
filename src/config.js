const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || "dev-secret",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin12345",
  adminPath: (process.env.ADMIN_PATH || "adminlazizabdu").replace(/^\/+/, ""),
  openbudgetApi: process.env.OPENBUDGET_API || "",
  botToken: process.env.BOT_TOKEN || "",
  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number),
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
};
