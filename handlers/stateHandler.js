const db = require("../database/db");
const kb = require("../ui/keyboards");
const { t, getUserLang, resolveLang } = require("../utils/i18n");

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
    const stateLang = resolveLang(state?.lang);
    if (!state?.step) return;

    // Регистрация: имя
    if (state.step === "reg_name" || state.step === "wait_name") {
      if (!isValidName(text)) {
        return bot.sendMessage(id, t(stateLang, "register.name_invalid"), kb.cancelMenu(stateLang));
      }

      db.get("SELECT id FROM users WHERE name=?", [text], (err, row) => {
        if (row) return bot.sendMessage(id, t(stateLang, "register.name_taken"), kb.cancelMenu(stateLang));
        state.name = text.trim();
        state.step = "reg_age";
        bot.sendMessage(id, t(stateLang, "register.age_ask"), kb.cancelMenu(stateLang));
      });
      return;
    }

    // Регистрация: возраст
    if (state.step === "reg_age") {
      const a = parseAge(text);
      if (!a) return bot.sendMessage(id, t(stateLang, "register.age_invalid"), kb.cancelMenu(stateLang));
      state.age = a;
      state.step = "reg_avatar";
      bot.sendMessage(id, t(stateLang, "register.avatar_ask"), kb.cancelMenu(stateLang));
      return;
    }

    // Регистрация: аватар
    if (state.step === "reg_avatar") {
      if (!isValidAvatar(text)) return bot.sendMessage(id, t(stateLang, "register.avatar_invalid"), kb.cancelMenu(stateLang));

      db.run(
        "INSERT INTO users (id, name, age, avatar, lang) VALUES (?, ?, ?, ?, ?)",
        [id, state.name, state.age, text, stateLang],
        (err) => {
        delete userState[id];
        if (err) return bot.sendMessage(id, t(stateLang, "register.failed"));
        bot.sendMessage(id, t(stateLang, "register.done"), kb.mainMenu(stateLang));
      });
      return;
    }

    // Смена аватара
    if (state.step === "wait_new_avatar") {
      return getUserLang(db, id).then((lang) => {
        if (!isValidAvatar(text)) return bot.sendMessage(id, t(lang, "register.avatar_invalid"), kb.cancelMenu(lang));

        db.run("UPDATE users SET avatar=? WHERE id=?", [text, id], (err) => {
          delete userState[id];
          if (err) return bot.sendMessage(id, t(lang, "profile.avatar_error"), kb.mainMenu(lang));
          bot.sendMessage(id, t(lang, "profile.avatar_updated"), kb.mainMenu(lang));
        });
      });
      return;
    }

    // Смена имени (с UNIQUE проверкой)
    if (state.step === "wait_new_name") {
      return getUserLang(db, id).then((lang) => {
        if (!isValidName(text)) return bot.sendMessage(id, t(lang, "register.name_invalid"), kb.cancelMenu(lang));

        db.get("SELECT id FROM users WHERE name=?", [text], (err, row) => {
          if (row) return bot.sendMessage(id, t(lang, "register.name_taken"), kb.cancelMenu(lang));

          db.run("UPDATE users SET name=? WHERE id=?", [text.trim(), id], (err2) => {
            delete userState[id];
            if (err2) return bot.sendMessage(id, t(lang, "profile.name_error"), kb.mainMenu(lang));
            bot.sendMessage(id, t(lang, "profile.name_updated"), kb.mainMenu(lang));
          });
        });
      });
      return;
    }

    // Промокод (пользователь)
    if (state.step === "wait_promo") {
      const code = text.toUpperCase().replace(/\s+/g, "");
      return getUserLang(db, id).then((lang) => {
        if (!code || code.length < 3 || code.length > 20) {
          return bot.sendMessage(id, t(lang, "promo.invalid"), kb.cancelMenu(lang));
        }

        db.get("SELECT 1 FROM promo_uses WHERE user_id=? AND code=?", [id, code], (e1, used) => {
          if (used) {
            delete userState[id];
            return bot.sendMessage(id, t(lang, "promo.used"), kb.mainMenu(lang));
          }

          db.get("SELECT reward_coins FROM promos WHERE code=?", [code], (e2, promo) => {
            if (!promo) return bot.sendMessage(id, t(lang, "promo.not_found"), kb.cancelMenu(lang));

            const reward = parseInt(promo.reward_coins || 0, 10) || 0;

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");

              db.run("UPDATE users SET coins = coins + ? WHERE id=?", [reward, id], function (e3) {
                if (e3 || this.changes === 0) {
                  return db.run("ROLLBACK", () => bot.sendMessage(id, t(lang, "promo.apply_error"), kb.mainMenu(lang)));
                }

                db.run("INSERT INTO promo_uses (user_id, code) VALUES (?, ?)", [id, code], (e4) => {
                  if (e4) return db.run("ROLLBACK", () => bot.sendMessage(id, t(lang, "promo.log_error"), kb.mainMenu(lang)));

                  db.run("COMMIT", () => {
                    delete userState[id];
                    bot.sendMessage(id, t(lang, "promo.applied", { reward: reward.toLocaleString() }), kb.mainMenu(lang));
                  });
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
