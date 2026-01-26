const db = require("../../database/db");

module.exports = (bot, adminId, userState, targetUserId) => {
  db.run(
    "UPDATE users SET coins=100, xp=0, level=1, current_lesson=1, current_task=0, accessories='[]', chests='[]', keys='[]', equipped='{}' WHERE id=?",
    [targetUserId],
    function (err) {
      delete userState[adminId];
      if (err) return bot.sendMessage(adminId, "❌ Ошибка обнуления.");
      bot.sendMessage(adminId, this.changes > 0 ? "🧨 Игрок обнулён!" : "❌ Игрок не найден.", { parse_mode: "HTML" });
    }
  );
};
