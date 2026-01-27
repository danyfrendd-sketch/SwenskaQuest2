// ui/keyboards.js
const { t } = require("../utils/i18n");

function mainMenu(lang = "ru") {
  return {
    reply_markup: {
      keyboard: [
        [t(lang, "menu.learn"), t(lang, "menu.shop")],
        [t(lang, "menu.chests"), t(lang, "menu.market")],
        [t(lang, "menu.inventory"), t(lang, "menu.profile")],
        [t(lang, "menu.leaderboard"), t(lang, "menu.settings")],
      ],
      resize_keyboard: true,
    },
  };
}

function cancelMenu(lang = "ru") {
  return {
    reply_markup: {
      keyboard: [[t(lang, "menu.cancel")]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

function backMenu(lang = "ru") {
  return {
    reply_markup: {
      keyboard: [[t(lang, "menu.back")]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

function settingsMenu(lang = "ru", audioEnabled = true) {
  const audioText = audioEnabled ? t(lang, "settings.toggle_audio_on") : t(lang, "settings.toggle_audio_off");
  return {
    inline_keyboard: [
      [{ text: t(lang, "settings.change_name"), callback_data: "set_name" }, { text: t(lang, "settings.change_avatar"), callback_data: "set_avatar" }],
      [{ text: audioText, callback_data: "toggle_audio" }],
      [{ text: t(lang, "settings.language"), callback_data: "set_lang" }],
      [{ text: t(lang, "settings.promo"), callback_data: "use_promo" }],
    ],
  };
}

function languageMenu(lang = "ru") {
  return {
    inline_keyboard: [
      [{ text: t(lang, "lang.set_ru"), callback_data: "lang_ru" }],
      [{ text: t(lang, "lang.set_en"), callback_data: "lang_en" }],
      [{ text: t(lang, "common.back"), callback_data: "set_back" }],
    ],
  };
}

module.exports = {
  mainMenu,
  cancelMenu,
  backMenu,
  settingsMenu,
  languageMenu,
};
