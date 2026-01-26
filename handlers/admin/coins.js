const db = require("../../database/db");

module.exports = (bot, adminId, userState, targetUserId, amountText) => {
  const amount = parseInt(amountText, 10);
  if (!Number.isFinite(amount)) {
    return bot.sendMessage(adminId, "❌ Введи число. Пример: 500 или -200");
  }

  db.run("UPDATE users SET coins = coins + ? WHERE id = ?", [amount, targetUserId], function (err) {
    delete userState[adminId];

    if (err) return bot.sendMessage(adminId, "❌ Ошибка обновления коинов.");
    if (this.changes === 0) return bot.sendMessage(adminId, "❌ Игрок не найден.");

    bot.sendMessage(adminId, `✅ Готово! Изменение: <b>${amount}</b> 🪙`, { parse_mode: "HTML" });
  });
};
