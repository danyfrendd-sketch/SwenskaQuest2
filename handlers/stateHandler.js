const db = require("../database/db");
const kb = require("../ui/keyboards");

function isValidName(name) {
  if (!name) return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 16) return false;
  return /^[\p{L}\p{N}_ ]+$/u.test(n);
}

function parseAge(text) {
  const n = parseInt(text, 10);
  if (!Number.isFinite(n) || n < 6 || n > 99) return null;
  return n;
}

function isValidAvatar(text) {
  const t = (text || "").trim();
  return t.length > 0 && t.length <= 4;
}

module.exports = {
  handle(bot, msg, userState) {
    const id = msg.chat.id;
    const text = (msg.text || "").trim();
    const state = userState[id];
    if (!state?.step) return;

    // Регистрация: имя
    if (state.step === "reg_name" || state.step === "wait_name") {
      if (!isValidName(text)) {
        return bot.sendMessage(id, "❌ Имя 2–16 символов (буквы/цифры/пробел/_). Повтори:", kb.cancelMenu);
      }

      db.get("SELECT id FROM users WHERE name=?", [text], (err, row) => {
        if (row) return bot.sendMessage(id, "❌ Это имя занято. Введи другое:", kb.cancelMenu);
        state.name = text.trim();
        state.step = "reg_age";
        bot.sendMessage(id, "🔢 Возраст? (6–99)", kb.cancelMenu);
      });
      return;
    }

    // Регистрация: возраст
    if (state.step === "reg_age") {
      const a = parseAge(text);
      if (!a) return bot.sendMessage(id, "❌ Возраст должен быть числом 6–99. Введи ещё раз:", kb.cancelMenu);
      state.age = a;
      state.step = "reg_avatar";
      bot.sendMessage(id, "🎭 Отправь эмодзи-аватар:", kb.cancelMenu);
      return;
    }

    // Регистрация: аватар
    if (state.step === "reg_avatar") {
      if (!isValidAvatar(text)) return bot.sendMessage(id, "❌ Введи 1 эмодзи (коротко):", kb.cancelMenu);

      db.run("INSERT INTO users (id, name, age, avatar) VALUES (?, ?, ?, ?)", [id, state.name, state.age, text], (err) => {
        delete userState[id];
        if (err) return bot.sendMessage(id, "❌ Ошибка регистрации. Попробуй ещё раз /start");
        bot.sendMessage(id, "✅ Регистрация завершена! Меню:", kb.mainMenu);
      });
      return;
    }

    // Смена аватара
    if (state.step === "wait_new_avatar") {
      if (!isValidAvatar(text)) return bot.sendMessage(id, "❌ Введи 1 эмодзи:", kb.cancelMenu);

      db.run("UPDATE users SET avatar=? WHERE id=?", [text, id], (err) => {
        delete userState[id];
        if (err) return bot.sendMessage(id, "❌ Ошибка обновления аватара.", kb.mainMenu);
        bot.sendMessage(id, "✅ Аватар обновлён!", kb.mainMenu);
      });
      return;
    }

    // Смена имени (с UNIQUE проверкой)
    if (state.step === "wait_new_name") {
      if (!isValidName(text)) return bot.sendMessage(id, "❌ Имя 2–16 символов. Повтори:", kb.cancelMenu);

      db.get("SELECT id FROM users WHERE name=?", [text], (err, row) => {
        if (row) return bot.sendMessage(id, "❌ Это имя занято. Введи другое:", kb.cancelMenu);

        db.run("UPDATE users SET name=? WHERE id=?", [text.trim(), id], (err2) => {
          delete userState[id];
          if (err2) return bot.sendMessage(id, "❌ Ошибка обновления имени.", kb.mainMenu);
          bot.sendMessage(id, "✅ Имя обновлено!", kb.mainMenu);
        });
      });
      return;
    }

    // Промокод (пользователь)
    if (state.step === "wait_promo") {
      const code = text.toUpperCase().replace(/\s+/g, "");
      if (!code || code.length < 3 || code.length > 20) {
        return bot.sendMessage(id, "❌ Промокод 3–20 символов. Повтори:", kb.cancelMenu);
      }

      db.get("SELECT 1 FROM promo_uses WHERE user_id=? AND code=?", [id, code], (e1, used) => {
        if (used) {
          delete userState[id];
          return bot.sendMessage(id, "❌ Ты уже использовал этот промокод.", kb.mainMenu);
        }

        db.get("SELECT reward_coins FROM promos WHERE code=?", [code], (e2, promo) => {
          if (!promo) return bot.sendMessage(id, "❌ Промокод не найден. Повтори или /cancel:", kb.cancelMenu);

          const reward = parseInt(promo.reward_coins || 0, 10) || 0;

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            db.run("UPDATE users SET coins = coins + ? WHERE id=?", [reward, id], function (e3) {
              if (e3 || this.changes === 0) {
                return db.run("ROLLBACK", () => bot.sendMessage(id, "❌ Ошибка начисления промо.", kb.mainMenu));
              }

              db.run("INSERT INTO promo_uses (user_id, code) VALUES (?, ?)", [id, code], (e4) => {
                if (e4) return db.run("ROLLBACK", () => bot.sendMessage(id, "❌ Ошибка фиксации промо.", kb.mainMenu));

                db.run("COMMIT", () => {
                  delete userState[id];
                  bot.sendMessage(id, `✅ Промокод применён! +${reward.toLocaleString()} 🪙`, kb.mainMenu);
                });
              });
            });
          });
        });
      });
      return;
    }
  }
};
