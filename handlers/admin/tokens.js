const db = require("../../database/db");

module.exports = (bot, adminId, userState, targetUserId, amountText) => {
  const amount = parseInt((amountText || "").trim(), 10);

  if (!Number.isFinite(amount)) {
    return bot.sendMessage(adminId, "❌ Введи число. Пример: 10 или -3");
  }

  db.run(
    "UPDATE users SET tokens = MAX(COALESCE(tokens,0) + ?, 0) WHERE id = ?",
    [amount, targetUserId],
    function (err) {
      delete userState[adminId];

      if (err) return bot.sendMessage(adminId, "❌ Ошибка обновления токенов.");
      if (this.changes === 0) return bot.sendMessage(adminId, "❌ Игрок не найден.");

      bot.sendMessage(
        adminId,
        `✅ Готово! Токены изменены на <b>${amount}</b> 💠 для <code>${targetUserId}</code>`,
        { parse_mode: "HTML" }
      );
    }
  );
};
