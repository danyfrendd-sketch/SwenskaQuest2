const db = require("../../database/db");

function safeParse(v) {
  try { return JSON.parse(v || "[]"); } catch { return []; }
}

module.exports = (bot, adminId, userState, targetUserId, type, rarity, qty = 1) => {
  db.get("SELECT chests, keys, name FROM users WHERE id=?", [targetUserId], (err, u) => {
    delete userState[adminId];

    if (err || !u) return bot.sendMessage(adminId, "❌ Игрок не найден.");

    const ch = safeParse(u.chests);
    const keys = safeParse(u.keys);

    const n = Math.max(1, Math.min(999, parseInt(qty, 10) || 1));

    if (type === "chest") {
      for (let i = 0; i < n; i++) ch.push({ r: rarity });
    } else {
      for (let i = 0; i < n; i++) keys.push(rarity);
    }

    db.run(
      "UPDATE users SET chests=?, keys=? WHERE id=?",
      [JSON.stringify(ch), JSON.stringify(keys), targetUserId],
      (err2) => {
        if (err2) return bot.sendMessage(adminId, "❌ Ошибка выдачи.");
        bot.sendMessage(
          adminId,
          `✅ Выдано <b>${u.name}</b>: <b>${n}x</b> ${type} [${rarity.toUpperCase()}]`,
          { parse_mode: "HTML" }
        );
      }
    );
  });
};
