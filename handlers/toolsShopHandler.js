// handlers/toolsShopHandler.js
const db = require("../database/db");
const kb = require("../ui/keyboards");
const tools = require("../data/tools");
const shopRaw = require("../data/shop");
const { normalizeInv, addItem } = require("../utils/inventory");
const { describeBuff } = require("../utils/buffsEngine");
const { t, getUserLang, resolveLang } = require("../utils/i18n");

function normalizeShop(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    return Object.values(raw).filter(Boolean);
  }
  return [];
}
const SHOP = normalizeShop(shopRaw);

function itemById(id) {
  return SHOP.find((x) => x && x.id === id) || null;
}

function sendToolsShop(bot, id, mid = null) {
  db.get("SELECT coins, tokens, lang FROM users WHERE id=?", [id], (err, u) => {
    const lang = resolveLang(u?.lang);
    if (err || !u) return bot.sendMessage(id, t(lang, "errors.not_found"), kb.mainMenu(lang));

    const tokens = u.tokens || 0;

    const lines = tools.map((t, i) => {
      const it = itemById(t.id) || { id: t.id, name: t.id, rarity: "common", price: 0 };
      const buff = describeBuff(it.id);
      return `${i + 1}) <b>${it.name}</b> • <i>${buff}</i>\n${t(lang, "shop.price_tokens", { price: t.tokenPrice })}`;
    });

    const text =
      `${t(lang, "shop.tools_title")}\n` +
      `${t(lang, "shop.balance_tokens", { tokens: tokens.toLocaleString() })}\n\n` +
      (lines.length ? lines.join("\n\n") : t(lang, "profile.empty"));

    const btns = tools.map((t) => {
      const it = itemById(t.id) || { id: t.id, name: t.id };
      return [{ text: t(lang, "shop.buy_tool", { item: it.name, price: t.tokenPrice }), callback_data: `tshop_buy_${t.id}` }];
    });

    btns.push([{ text: t(lang, "menu.back"), callback_data: "tshop_back" }]);

    const opt = { parse_mode: "HTML", reply_markup: { inline_keyboard: btns } };
    return mid
      ? bot.editMessageText(text, { chat_id: id, message_id: mid, ...opt }).catch(() => {})
      : bot.sendMessage(id, text, opt);
  });
}

function handleCallbacks(bot, q, userState) {
  const id = q.message.chat.id;
  const mid = q.message.message_id;
  const data = q.data || "";

  if (data === "tshop_back") {
    return getUserLang(db, id).then((lang) => bot.sendMessage(id, t(lang, "menu.main_title"), kb.mainMenu(lang)));
  }

  if (data.startsWith("tshop_buy_")) {
    const itemId = data.replace("tshop_buy_", "");
    const row = tools.find((x) => x && x.id === itemId);
    if (!row) {
      return getUserLang(db, id).then((lang) => bot.answerCallbackQuery(q.id, { text: t(lang, "shop.tool_not_found") }).catch(() => {}));
    }

    db.get("SELECT tokens, accessories FROM users WHERE id=?", [id], (err, u) => {
      const lang = resolveLang(u?.lang);
      if (err || !u) return bot.answerCallbackQuery(q.id, { text: t(lang, "errors.generic") }).catch(() => {});
      const tokens = u.tokens || 0;
      if (tokens < row.tokenPrice) {
        return bot.answerCallbackQuery(q.id, { text: t(lang, "shop.not_enough_tokens"), show_alert: true }).catch(() => {});
      }

      const inv = normalizeInv(u.accessories);
      addItem(inv, itemId, 10);

      db.run(
        "UPDATE users SET tokens=tokens-?, accessories=? WHERE id=?",
        [row.tokenPrice, JSON.stringify(inv), id],
        () => {
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.tool_bought", { price: row.tokenPrice }) }).catch(() => {});
          sendToolsShop(bot, id, mid);
        }
      );
    });

    return;
  }
}

module.exports = { sendToolsShop, handleCallbacks };
