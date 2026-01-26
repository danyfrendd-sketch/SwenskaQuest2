// ui/keyboards.js
module.exports = {
  mainMenu: {
    reply_markup: {
      keyboard: [
        ["📘 Уроки", "🛒 Магазин"],
        ["🎁 Сундуки", "💰 Рынок"],
        ["🎒 Экипировка", "👤 Профиль"],
        ["🏆 Лидеры", "⚙️ Настройки"],
      ],
      resize_keyboard: true,
    },
  },

  cancelMenu: {
    reply_markup: {
      keyboard: [["❌ Отмена"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  },

  backMenu: {
    reply_markup: {
      keyboard: [["🔙 В меню"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  },
};
