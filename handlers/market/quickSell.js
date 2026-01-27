// handlers/market/quickSell.js
const db = require("../../database/db");
const { normalizeInv, removeOneItem } = require("../../utils/inventory");
const { formatLine } = require("../../utils/itemCard");
const { priceToSystem } = require("../../utils/pricing");
const { t, getUserLang } = require("../../utils/i18n");

function sendQuickSellMenu(bot, id, userState) {
  db.get("SELECT accessories FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return;

    const inv = normalizeInv(u.accessories);
    const items = inv.filter((x) => x && x.id && (Number.isFinite(x.d) ? x.d : 10) > 0);

    if (!items.length) {
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "market.quick_sell_empty"), {
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, "common.back"), callback_data: "pm_menu" }]],
          },
        })
      );
    }

    userState[id] = userState[id] || {};
    userState[id].qs = { list: items.map((x) => ({ id: x.id, d: Number.isFinite(x.d) ? x.d : 10 })) };

    const lines = userState[id].qs.list.map((it, i) => {
      const price = priceToSystem(it.id, it.d);
      return `${i + 1}. ${formatLine(it.id, it.d)} → 💰 ${price}`;
    });

    getUserLang(db, id).then((lang) => {
      const ik = userState[id].qs.list.map((_, i) => [
        { text: t(lang, "market.quick_sell_button", { index: i + 1 }), callback_data: `qs_sell_${i}` },
      ]);

      ik.push([{ text: t(lang, "common.back"), callback_data: "pm_menu" }]);

      bot.sendMessage(id, t(lang, "market.quick_sell_title", { lines: lines.join("\n") }), {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: ik },
      });
    });
  });
}

function handleCallbacks(bot, q, userState) {
  const id = q.message.chat.id;
  const data = q.data;

  if (!data.startsWith("qs_")) return;

  if (data === "qs_menu") return sendQuickSellMenu(bot, id, userState);

  if (data.startsWith("qs_sell_")) {
    const idx = parseInt(data.replace("qs_sell_", ""), 10);
    const st = userState?.[id]?.qs;
    if (!st) return;

    const it = st.list?.[idx];
    if (!it) return;

    const price = priceToSystem(it.id, it.d);
    if (!price || price <= 0) {
      return getUserLang(db, id).then((lang) =>
        bot.answerCallbackQuery(q.id, { text: t(lang, "market.quick_sell_not_sellable") })
      );
    }

    db.get("SELECT accessories, coins FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const inv = normalizeInv(u.accessories);
      const ok = removeOneItem(inv, it.id);

      if (!ok) {
        return getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "market.quick_sell_item_missing") })
        );
      }

      const newCoins = Number(u.coins || 0) + price;

      db.run(
        "UPDATE users SET accessories=?, coins=? WHERE id=?",
        [JSON.stringify(inv), newCoins, id],
        () => {
          getUserLang(db, id).then((lang) => {
            bot.sendMessage(id, t(lang, "market.quick_sell_ok", { item: formatLine(it.id, it.d), price }), {
              parse_mode: "HTML",
            });
            sendQuickSellMenu(bot, id, userState);
          });
        }
      );
    });
  }
}

module.exports = {
  sendQuickSellMenu,
  handleCallbacks,
};
