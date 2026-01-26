// handlers/adminHandler.js
const db = require("../database/db");

const coinsMod = require("./admin/coins");
const lootMod = require("./admin/loot");
const resetMod = require("./admin/reset");
const promoMod = require("./admin/promo");
const tokensMod = require("./admin/tokens");

const activity = require("../utils/activityLog");
const { BOT_PLAYERS } = require("../bots/aiBots");

const PAGE_SIZE = 8;
const RARITIES = ["common", "rare", "epic", "legendary"];

function isAdmin(id, ADMIN_ID) {
  return id === ADMIN_ID;
}

function esc(s) {
  return String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function adminPanelKeyboard() {
  return [
    [{ text: "💰 Коины", callback_data: "adm_act_coins" }, { text: "💠 Токены", callback_data: "adm_act_tokens" }],
    [{ text: "🎁 Лут", callback_data: "adm_act_loot" }, { text: "🧨 Обнулить", callback_data: "adm_act_reset" }],
    [{ text: "🎫 Промо", callback_data: "adm_act_promo" }],
    [{ text: "🤖 Активность ботов", callback_data: "adm_act_bots" }],
  ];
}

function showAdminPanel(bot, chatId, mid = null) {
  const opt = {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: adminPanelKeyboard() },
  };
  if (mid) {
    return bot.editMessageText("🛠 <b>АДМИН-ПАНЕЛЬ</b>", { chat_id: chatId, message_id: mid, ...opt }).catch(() => {});
  }
  bot.sendMessage(chatId, "🛠 <b>АДМИН-ПАНЕЛЬ</b>", opt);
}

function showUsersPage(bot, chatId, action, page = 0, mid = null) {
  const offset = page * PAGE_SIZE;
  db.all(
    "SELECT id, name, avatar, level FROM users ORDER BY level DESC, coins DESC LIMIT ? OFFSET ?",
    [PAGE_SIZE, offset],
    (err, rows) => {
      if (err) return bot.sendMessage(chatId, "❌ Ошибка чтения пользователей.");

      const list = rows || [];
      const text =
        `👥 <b>Выбери игрока</b>\n` +
        `Действие: <code>${action}</code>\n` +
        `Страница: <code>${page + 1}</code>\n\n` +
        (list.length
          ? list.map((u, i) => `${i + 1}. ${esc(u.avatar)} <b>${esc(u.name)}</b> (lvl ${u.level})`).join("\n")
          : "Пусто.");

      const btns = list.map((u) => [
        { text: `${u.avatar || "👤"} ${u.name}`, callback_data: `adm_pick_${action}_${u.id}_${page}` },
      ]);

      const nav = [];
      if (page > 0) nav.push({ text: "⬅️", callback_data: `adm_users_${action}_${page - 1}` });
      nav.push({ text: "🔙 Панель", callback_data: "adm_back_panel" });
      if (list.length === PAGE_SIZE) nav.push({ text: "➡️", callback_data: `adm_users_${action}_${page + 1}` });

      btns.push(nav);

      const opt = { parse_mode: "HTML", reply_markup: { inline_keyboard: btns } };
      if (mid) return bot.editMessageText(text, { chat_id: chatId, message_id: mid, ...opt }).catch(() => {});
      bot.sendMessage(chatId, text, opt);
    }
  );
}

// ---- BOT LOGS (DB) ----
function botsLogsKeyboard() {
  const rows = [];
  rows.push([{ text: "🕒 Последние 20 событий", callback_data: "adm_bots_recent" }]);
  for (const b of BOT_PLAYERS) rows.push([{ text: `${b.avatar} ${b.name}`, callback_data: `adm_bots_user_${b.id}` }]);
  rows.push([{ text: "🔙 Панель", callback_data: "adm_back_panel" }]);
  return rows;
}

function showBotsLogsMenu(bot, chatId, mid) {
  const text = `🤖 <b>АКТИВНОСТЬ БОТОВ</b>\n\nВыбери что смотреть:`;
  const opt = { parse_mode: "HTML", reply_markup: { inline_keyboard: botsLogsKeyboard() } };
  return bot.editMessageText(text, { chat_id: chatId, message_id: mid, ...opt }).catch(() => {});
}

function showRecentBotsLogs(bot, chatId, mid) {
  activity.getRecent(20, (err, rows) => {
    const txt = `🤖 <b>ПОСЛЕДНИЕ СОБЫТИЯ</b>\n\n${activity.format(rows)}`;
    const opt = { parse_mode: "HTML", reply_markup: { inline_keyboard: botsLogsKeyboard() } };
    bot.editMessageText(txt, { chat_id: chatId, message_id: mid, ...opt }).catch(() => {});
  });
}

function showBotLogs(bot, chatId, botId, mid) {
  activity.getRecentByUser(botId, 20, (err, rows) => {
    const txt = `🤖 <b>СОБЫТИЯ БОТА ${botId}</b>\n\n${activity.format(rows)}`;
    const opt = { parse_mode: "HTML", reply_markup: { inline_keyboard: botsLogsKeyboard() } };
    bot.editMessageText(txt, { chat_id: chatId, message_id: mid, ...opt }).catch(() => {});
  });
}

module.exports = {
  showPanel(bot, id) {
    bot.sendMessage(id, "🛠 <b>АДМИН-ПАНЕЛЬ</b>", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: adminPanelKeyboard() },
    });
  },

  handleCallbacks(bot, q, userState, ADMIN_ID) {
    const id = q.message.chat.id;
    const mid = q.message.message_id;
    const data = q.data || "";

    if (!isAdmin(id, ADMIN_ID)) return;

    if (data === "adm_back_panel") {
      userState[id] = undefined;
      return showAdminPanel(bot, id, mid);
    }

    if (data === "adm_act_coins") return showUsersPage(bot, id, "coins", 0, mid);
    if (data === "adm_act_tokens") return showUsersPage(bot, id, "tokens", 0, mid);
    if (data === "adm_act_loot") return showUsersPage(bot, id, "loot", 0, mid);
    if (data === "adm_act_reset") return showUsersPage(bot, id, "reset", 0, mid);

    if (data === "adm_act_promo") {
      userState[id] = { step: "adm_wait_promo_code" };
      return bot.sendMessage(id, "🎫 Введи код промо:", { parse_mode: "HTML" });
    }

    // ---- logs ----
    if (data === "adm_act_bots") return showBotsLogsMenu(bot, id, mid);
    if (data === "adm_bots_recent") return showRecentBotsLogs(bot, id, mid);
    if (data.startsWith("adm_bots_user_")) {
      const botId = parseInt(data.replace("adm_bots_user_", ""), 10);
      if (!Number.isFinite(botId)) return;
      return showBotLogs(bot, id, botId, mid);
    }

    if (data.startsWith("adm_users_")) {
      const [, , action, page] = data.split("_");
      return showUsersPage(bot, id, action, parseInt(page, 10) || 0, mid);
    }

    if (data.startsWith("adm_pick_")) {
      const [, , action, targetId] = data.split("_");
      const targetUserId = parseInt(targetId, 10);

      if (action === "coins") {
        userState[id] = { step: "adm_wait_coins", targetUserId };
        return bot.sendMessage(id, "💰 Введи сумму (пример: 500 или -200):");
      }

      if (action === "tokens") {
        userState[id] = { step: "adm_wait_tokens", targetUserId };
        return bot.sendMessage(id, "💠 Введи токены (пример: 10 или -3):");
      }

      if (action === "loot") {
        const btns = [
          [{ text: "🎁 Сундук", callback_data: `adm_loot_type_chest_${targetUserId}` }],
          [{ text: "🔑 Ключ", callback_data: `adm_loot_type_key_${targetUserId}` }],
          [{ text: "🔙 Назад", callback_data: "adm_back_panel" }],
        ];
        return bot.sendMessage(id, "🎁 Что выдать?", { reply_markup: { inline_keyboard: btns } });
      }

      if (action === "reset") {
        userState[id] = { step: "adm_wait_reset", targetUserId };
        return bot.sendMessage(id, "🧨 Напиши: YES чтобы подтвердить обнуление");
      }
    }

    if (data.startsWith("adm_loot_type_")) {
      const [, , , type, targetUserIdStr] = data.split("_");
      const targetUserId = parseInt(targetUserIdStr, 10);

      const btns = RARITIES.map((r) => [{ text: r.toUpperCase(), callback_data: `adm_loot_r_${type}_${r}_${targetUserId}` }]);
      btns.push([{ text: "🔙 Назад", callback_data: "adm_back_panel" }]);
      return bot.sendMessage(id, `Выбери редкость для ${type}:`, { reply_markup: { inline_keyboard: btns } });
    }

    if (data.startsWith("adm_loot_r_")) {
      const [, , , type, rarity, targetUserIdStr] = data.split("_");
      const targetUserId = parseInt(targetUserIdStr, 10);

      userState[id] = { step: "adm_wait_loot_qty", targetUserId, lootType: type, lootRarity: rarity };
      return bot.sendMessage(id, "Введи количество (например: 5):");
    }
  },

  handleInput(bot, msg, userState, ADMIN_ID) {
    const id = msg.chat.id;
    if (!isAdmin(id, ADMIN_ID)) return;

    const st = userState[id];
    if (!st?.step) return;

    if (st.step === "adm_wait_coins") {
      return coinsMod(bot, id, userState, st.targetUserId, msg.text);
    }

    if (st.step === "adm_wait_tokens") {
      return tokensMod(bot, id, userState, st.targetUserId, msg.text);
    }

    if (st.step === "adm_wait_loot_qty") {
      const qty = parseInt(msg.text, 10);
      if (!Number.isFinite(qty) || qty <= 0 || qty > 999) return bot.sendMessage(id, "❌ Введи число 1..999");
      const { targetUserId, lootType, lootRarity } = st;
      return lootMod(bot, id, userState, targetUserId, lootType, lootRarity, qty);
    }

    if (st.step === "adm_wait_reset") {
      if ((msg.text || "").trim().toUpperCase() !== "YES") return bot.sendMessage(id, "❌ Отменено.");
      return resetMod(bot, id, userState, st.targetUserId);
    }

    if (st.step === "adm_wait_promo_code") {
      return promoMod(bot, id, userState, msg.text, ADMIN_ID);
    }
  },
};
