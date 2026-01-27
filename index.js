// index.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const db = require("./database/db");
const kb = require("./ui/keyboards");
const { t, getUserLang, matchesLocaleText, resolveLang } = require("./utils/i18n");

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

function detectLang(from) {
  const code = String(from?.language_code || "").toLowerCase();
  if (code.startsWith("en")) return "en";
  if (code.startsWith("ru")) return "ru";
  return "ru";
}

bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  db.get("SELECT id, lang FROM users WHERE id=?", [id], (err, row) => {
    if (row) {
      const lang = resolveLang(row.lang);
      return bot.sendMessage(id, t(lang, "menu.main_title"), kb.mainMenu(lang));
    }
    const lang = detectLang(msg.from);
    userState[id] = { step: "reg_name", lang };
    bot.sendMessage(id, t(lang, "register.hello"), kb.cancelMenu(lang));
  });
});

bot.onText(/\/lang/, (msg) => {
  const id = msg.chat.id;
  getUserLang(db, id).then((lang) => {
    bot.sendMessage(id, t(lang, "lang.title"), { parse_mode: "HTML", reply_markup: kb.languageMenu(lang) });
  });
});

bot.on("message", (msg) => {
  const id = msg.chat.id;
  const text = msg.text || "";

  if (text === "/admin") {
    if (id !== ADMIN_ID) {
      getUserLang(db, id).then((lang) => bot.sendMessage(id, t(lang, "errors.no_access")));
      return;
    }
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

  if (matchesLocaleText(text, "menu.learn")) return game.sendLessonTask(bot, id);
  if (matchesLocaleText(text, "menu.profile")) return game.sendProfile(bot, id);
  if (matchesLocaleText(text, "menu.shop")) return shopFilter.sendShop(bot, id, userState);
  if (matchesLocaleText(text, "menu.chests")) return game.sendChestsMenu(bot, id);
  if (matchesLocaleText(text, "menu.inventory")) return equipment.sendEquipMenu(bot, id);
  if (matchesLocaleText(text, "menu.market")) return market.sendMarketMenu(bot, id, userState);
  if (matchesLocaleText(text, "menu.leaderboard")) return game.sendLeaderboard(bot, id);
  if (matchesLocaleText(text, "menu.settings")) return game.sendSettings(bot, id);

  if (matchesLocaleText(text, "menu.back")) {
    getUserLang(db, id).then((lang) => bot.sendMessage(id, t(lang, "menu.main_title"), kb.mainMenu(lang)));
    return;
  }

  if (matchesLocaleText(text, "menu.cancel")) {
    delete userState[id];
    getUserLang(db, id).then((lang) => bot.sendMessage(id, t(lang, "menu.main_title"), kb.mainMenu(lang)));
    return;
  }

  getUserLang(db, id).then((lang) => bot.sendMessage(id, t(lang, "menu.pick_action"), kb.mainMenu(lang)));
  return;
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
    data.startsWith("set_") ||
    data.startsWith("lang_")
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
