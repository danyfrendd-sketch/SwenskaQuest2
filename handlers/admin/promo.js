const db = require("../../database/db");

module.exports = (bot, adminId, userState, codeText, ADMIN_ID) => {
  const code = (codeText || "").toUpperCase().replace(/\s+/g, "");
  if (!code || code.length < 3 || code.length > 20) {
    return bot.sendMessage(
      adminId,
      "❌ CODE должен быть 3–20 символов. Пример: <code>WELCOME</code>",
      { parse_mode: "HTML" }
    );
  }

  const reward = 500;

  db.run(
    "INSERT INTO promos (code, owner_id, reward_coins) VALUES (?, ?, ?)",
    [code, ADMIN_ID, reward],
    (err) => {
      delete userState[adminId];

      if (err) {
        return bot.sendMessage(adminId, "❌ Такой промокод уже существует.");
      }

      bot.sendMessage(
        adminId,
        `✅ Промокод создан: <b>${code}</b>\nНаграда: <b>${reward}</b> 🪙`,
        { parse_mode: "HTML" }
      );
    }
  );
};
