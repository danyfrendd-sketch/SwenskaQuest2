// handlers/market/quickSell.js
const db = require("../../database/db");
const { normalizeInv, removeOneItem } = require("../../utils/inventory");
const { formatLine } = require("../../utils/itemCard");
const { priceToSystem } = require("../../utils/pricing");

function sendQuickSellMenu(bot, id, userState) {
  db.get("SELECT accessories FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return;

    const inv = normalizeInv(u.accessories);
    const items = inv.filter((x) => x && x.id && (Number.isFinite(x.d) ? x.d : 10) > 0);

    if (!items.length) {
      return bot.sendMessage(id, "🎒 У тебя нет предметов для продажи системе.", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Назад", callback_data: "pm_menu" }]],
        },
      });
    }

    userState[id] = userState[id] || {};
    userState[id].qs = { list: items.map((x) => ({ id: x.id, d: Number.isFinite(x.d) ? x.d : 10 })) };

    const lines = userState[id].qs.list.map((it, i) => {
      const price = priceToSystem(it.id, it.d);
      return `${i + 1}. ${formatLine(it.id, it.d)} → 💰 ${price}`;
    });

    const ik = userState[id].qs.list.map((_, i) => [
      { text: `Продать #${i + 1}`, callback_data: `qs_sell_${i}` },
    ]);

    ik.push([{ text: "🔙 Назад", callback_data: "pm_menu" }]);

    bot.sendMessage(id, `🏦 <b>Продать системе</b>\n\n${lines.join("\n")}`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: ik },
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
      return bot.answerCallbackQuery(q.id, { text: "❌ Этот предмет нельзя продать системе." });
    }

    db.get("SELECT accessories, coins FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const inv = normalizeInv(u.accessories);
      const ok = removeOneItem(inv, it.id);

      if (!ok) {
        return bot.answerCallbackQuery(q.id, { text: "❌ Предмет не найден." });
      }

      const newCoins = Number(u.coins || 0) + price;

      db.run(
        "UPDATE users SET accessories=?, coins=? WHERE id=?",
        [JSON.stringify(inv), newCoins, id],
        () => {
          bot.sendMessage(id, `✅ Продано системе: ${formatLine(it.id, it.d)}\n💰 Получено: ${price}`, {
            parse_mode: "HTML",
          });
          sendQuickSellMenu(bot, id, userState);
        }
      );
    });
  }
}

module.exports = {
  sendQuickSellMenu,
  handleCallbacks,
};
