// index.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const db = require("./database/db");
const kb = require("./ui/keyboards");

const game = require("./handlers/gameHandler");
const states = require("./handlers/stateHandler");
const admin = require("./handlers/adminHandler");
const settings = require("./handlers/settingsHandler");
const market = require("./handlers/market/trade");
const quickSell = require("./handlers/market/quickSell");
const shopFilter = require("./handlers/shopFilterHandler");
const equipment = require("./handlers/equipmentHandler");

// ✅ наши NPC из папки bots/
const { startBots } = require("./bots/aiBots");

// --- FIX: защита от криво заданного BOT_TOKEN ("BOT_TOKEN=....") ---
const RAW_TOKEN = process.env.BOT_TOKEN || "";
const BOT_TOKEN = RAW_TOKEN.replace(/^BOT_TOKEN=/, "").trim();

if (!BOT_TOKEN || !BOT_TOKEN.includes(":")) {
  console.log("❌ BOT_TOKEN не задан или задан неправильно.");
  console.log("❗ В переменной BOT_TOKEN должно быть только значение токена вида 123:ABC..., без 'BOT_TOKEN='.");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const ADMIN_ID = parseInt(String(process.env.ADMIN_ID || "0"), 10) || 0;
const userState = {};

// ✅ запускаем NPC (они работают только с DB, не пишут в чат)
startBots(db);

// ✅ лог ошибок polling
bot.on("polling_error", (e) => {
  console.log("POLLING_ERROR:", e?.message || e);
  console.log("POLLING_ERROR_FULL:", e);
});

bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  db.get("SELECT id FROM users WHERE id=?", [id], (err, row) => {
    if (row) return bot.sendMessage(id, "🎮 Меню:", kb.mainMenu);
    userState[id] = { step: "reg_name" };
    bot.sendMessage(id, "👋 Привет! Напиши своё имя:", kb.cancelMenu);
  });
});

bot.on("message", (msg) => {
  const id = msg.chat.id;
  const text = msg.text || "";

  if (text === "/admin") {
    if (id !== ADMIN_ID) return bot.sendMessage(id, "⛔️ Нет доступа.");
    return admin.showPanel(bot, id, userState);
  }

  if (userState[id]?.step) {
    const step = userState[id].step;

    if (id === ADMIN_ID && step.startsWith("adm_")) {
      return admin.handleInput(bot, msg, userState, ADMIN_ID);
    }

    // ✅ рынок: ввод цены/сумм
    if (step.startsWith("pm_") || step.startsWith("mkt_")) {
      const handled = market.handleInput(bot, msg, userState);
      if (handled) return;
    }

    return states.handle(bot, msg, userState);
  }

  switch (text) {
    case "📘 Уроки": return game.sendLessonTask(bot, id);
    case "👤 Профиль": return game.sendProfile(bot, id);
    case "🛒 Магазин": return shopFilter.sendShop(bot, id, userState);
    case "🎁 Сундуки": return game.sendChestsMenu(bot, id);
    case "🎒 Экипировка": return equipment.sendEquipMenu(bot, id);

    case "💰 Рынок":
      return market.sendMarketMenu(bot, id, userState);

    case "🏆 Лидеры": return game.sendLeaderboard(bot, id);
    case "⚙️ Настройки": return game.sendSettings(bot, id);

    case "🔙 В меню": return bot.sendMessage(id, "🎮 Меню:", kb.mainMenu);

    case "❌ Отмена":
      delete userState[id];
      return bot.sendMessage(id, "🎮 Меню:", kb.mainMenu);

    default:
      return bot.sendMessage(id, "Выбери действие из меню 👇", kb.mainMenu);
  }
});

bot.on("callback_query", (q) => {
  bot.answerCallbackQuery(q.id).catch(() => {});
  const data = q.data || "";

  if (data.startsWith("adm_")) return admin.handleCallbacks(bot, q, userState, ADMIN_ID);
  if (data.startsWith("shopf_")) return shopFilter.handleCallbacks(bot, q, userState);
  if (data.startsWith("eq_")) return equipment.handleCallbacks(bot, q, userState);

  // ✅ рынок (pm_ и mkt_)
  if (data.startsWith("pm_") || data.startsWith("mkt_")) return market.handleMarketCallback(bot, q, userState);

  // ✅ продажа системе (quickSell)
  if (data.startsWith("qs_")) return quickSell.handleCallbacks(bot, q, userState);

  // ✅ настройки
  if (
    data === "set_name" ||
    data === "set_avatar" ||
    data === "toggle_audio" ||
    data === "use_promo" ||
    data.startsWith("set_")
  ) {
    return settings.handleCallbacks(bot, q, userState);
  }

  return game.handleCallbacks(bot, q, userState);
});

console.log("✅ SuomiQuestBot активен!");

// --- FIX: healthcheck для Koyeb Web Service (иначе убивает SIGTERM) ---
const http = require("http");
const PORT = parseInt(String(process.env.PORT || "8000"), 10) || 8000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
}).listen(PORT, () => {
  console.log("✅ Health server on port", PORT);
});
