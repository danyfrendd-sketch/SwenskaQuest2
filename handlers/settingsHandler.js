const db = require("../database/db");
const kb = require("../ui/keyboards");
const { t, getUserLang, resolveLang } = require("../utils/i18n");

module.exports = {
  handleCallbacks(bot, q, userState) {
    const id = q.message.chat.id;

    if (q.data === "set_avatar") {
      userState[id] = { step: "wait_new_avatar" };
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "settings.ask_avatar"), kb.cancelMenu(lang))
      );
    }

    if (q.data === "set_name") {
      userState[id] = { step: "wait_new_name" };
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "settings.ask_name"), kb.cancelMenu(lang))
      );
    }

    if (q.data === "toggle_audio") {
      db.run("UPDATE users SET audio_enabled = 1 - audio_enabled WHERE id=?", [id], () => {
        db.get("SELECT audio_enabled, lang FROM users WHERE id=?", [id], (err, u) => {
          const lang = resolveLang(u?.lang);
          const status = u?.audio_enabled ? t(lang, "profile.sound_on") : t(lang, "profile.sound_off");
          bot.sendMessage(id, t(lang, "settings.audio_changed", { status }), kb.mainMenu(lang));
        });
      });
      return;
    }

    if (q.data === "use_promo") {
      userState[id] = { step: "wait_promo" };
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "settings.ask_promo"), kb.cancelMenu(lang))
      );
    }

    if (q.data === "set_lang") {
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "lang.title"), { parse_mode: "HTML", reply_markup: kb.languageMenu(lang) })
      );
    }

    if (q.data === "set_back") {
      return db.get("SELECT audio_enabled, lang FROM users WHERE id=?", [id], (err, u) => {
        const lang = resolveLang(u?.lang);
        const menu = kb.settingsMenu(lang, !!u?.audio_enabled);
        bot.sendMessage(id, t(lang, "settings.title"), { parse_mode: "HTML", reply_markup: menu });
      });
    }

    if (q.data === "lang_ru" || q.data === "lang_en") {
      const newLang = q.data === "lang_en" ? "en" : "ru";
      db.run("UPDATE users SET lang=? WHERE id=?", [newLang, id], () => {
        db.get("SELECT audio_enabled FROM users WHERE id=?", [id], (err, u) => {
          const lang = resolveLang(newLang);
          const menu = kb.settingsMenu(lang, !!u?.audio_enabled);
          bot.sendMessage(id, t(lang, "lang.changed"));
          bot.sendMessage(id, t(lang, "settings.title"), { parse_mode: "HTML", reply_markup: menu });
          bot.sendMessage(id, t(lang, "menu.main_title"), kb.mainMenu(lang));
        });
      });
      return;
    }
  }
};
