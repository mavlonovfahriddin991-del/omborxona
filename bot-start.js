const { startBot } = require("./src/bot");

console.log("[bot] Ishga tushiryapti...");
startBot()
  .then(() => console.log("[bot] Tayyor. To'xtatish uchun Ctrl+C"))
  .catch((e) => {
    console.error("[bot] XATO:", e.message);
    process.exit(1);
  });

process.on("SIGINT", () => {
  console.log("\n[bot] To'xtatildi");
  process.exit(0);
});
