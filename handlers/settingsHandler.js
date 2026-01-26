const db = require("../database/db");
const kb = require("../ui/keyboards");

module.exports = {
  handleCallbacks(bot, q, userState) {
    const id = q.message.chat.id;

    if (q.data === "set_avatar") {
      userState[id] = { step: "wait_new_avatar" };
      return bot.sendMessage(id, "🎭 Отправь новый эмодзи:", kb.cancelMenu);
    }

    if (q.data === "set_name") {
      userState[id] = { step: "wait_new_name" };
      return bot.sendMessage(id, "📝 Напиши новое имя:", kb.cancelMenu);
    }

    if (q.data === "toggle_audio") {
      db.run("UPDATE users SET audio_enabled = 1 - audio_enabled WHERE id=?", [id], () => {
        db.get("SELECT audio_enabled FROM users WHERE id=?", [id], (err, u) => {
          const status = u?.audio_enabled ? "🔊 ВКЛ" : "🔇 ВЫКЛ";
          bot.sendMessage(id, `✅ Звук: ${status}`, kb.mainMenu);
        });
      });
      return;
    }

    if (q.data === "use_promo") {
      userState[id] = { step: "wait_promo" };
      return bot.sendMessage(id, "🎫 Введи промокод:", kb.cancelMenu);
    }
  }
};
