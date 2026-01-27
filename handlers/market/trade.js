// handlers/market/trade.js
const db = require("../../database/db");
const { normalizeInv, addItem, removeOneItem } = require("../../utils/inventory");
const { formatLine } = require("../../utils/itemCard");
const { priceToSystem, shopPrice } = require("../../utils/pricing");
const { t, getUserLang, resolveLang } = require("../../utils/i18n");

const PAGE_SIZE = 6;

function toInt(x, def = 0) {
  const n = parseInt(String(x), 10);
  return Number.isFinite(n) ? n : def;
}

function getPrefix(data) {
  if (String(data || "").startsWith("pm_")) return "pm";
  return "mkt";
}

function menuKb(prefix, lang = "ru") {
  const p = prefix || "mkt";
  return {
    inline_keyboard: [
      [{ text: t(lang, "market.menu_view"), callback_data: `${p}_list_0` }],
      [{ text: t(lang, "market.menu_sell"), callback_data: `${p}_sell_pick` }],
      [{ text: t(lang, "market.menu_my"), callback_data: `${p}_my_0` }],
      [{ text: t(lang, "market.menu_sell_system"), callback_data: `qs_menu` }],
      [{ text: t(lang, "common.back"), callback_data: `${p}_back` }],
    ],
  };
}

function ensureState(userState, id) {
  userState[id] = userState[id] || {};
  userState[id].market = userState[id].market || {};
  return userState[id].market;
}

// ---------- UI ----------
function sendMarketMenu(bot, id, userState, prefix = "mkt") {
  ensureState(userState, id);
  getUserLang(db, id).then((lang) => {
    bot.sendMessage(id, t(lang, "market.title"), {
      parse_mode: "HTML",
      reply_markup: menuKb(prefix, lang),
    });
  });
}

function renderLots(bot, id, prefix, page) {
  const offset = page * PAGE_SIZE;

  db.all(
    `SELECT m.lot_id, m.seller_id, m.item_id, m.item_d, m.currency, m.price, m.created_at,
            u.name as seller_name, u.avatar as seller_avatar
     FROM market m
     LEFT JOIN users u ON u.id = m.seller_id
     ORDER BY m.lot_id DESC
     LIMIT ? OFFSET ?`,
    [PAGE_SIZE, offset],
    (err, rows) => {
      const lots = rows || [];

      return getUserLang(db, id).then((lang) => {
        if (!lots.length) {
          return bot.sendMessage(id, t(lang, "market.empty"), {
            parse_mode: "HTML",
            reply_markup: menuKb(prefix, lang),
          });
        }

        const lines = lots.map((l, i) => {
          const itemText = formatLine(l.item_id, Number(l.item_d || 10));
          const cur = l.currency === "tokens" ? "💠" : "🪙";
          const seller = `${l.seller_avatar || "🙂"} ${l.seller_name || l.seller_id}`;
          return t(lang, "market.lot_line", {
            index: i + 1,
            item: itemText,
            price: l.price,
            cur,
            seller,
            lotId: l.lot_id,
          });
        });

        const ik = lots.map((l, i) => [
          { text: t(lang, "market.buy_button", { index: i + 1 }), callback_data: `${prefix}_buy_${l.lot_id}` },
        ]);

      const nav = [];
      if (page > 0) nav.push({ text: "⬅️", callback_data: `${prefix}_list_${page - 1}` });
      nav.push({ text: `📄 ${page + 1}`, callback_data: `${prefix}_noop` });
      nav.push({ text: "➡️", callback_data: `${prefix}_list_${page + 1}` });
      ik.push(nav);

        ik.push([{ text: t(lang, "market.menu_market"), callback_data: `${prefix}_menu` }]);

        bot.sendMessage(id, t(lang, "market.lots_title", { lines: lines.join("\n\n") }), {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: ik },
        });
      });
    }
  );
}

function renderMyLots(bot, id, prefix, page) {
  const offset = page * PAGE_SIZE;

  db.all(
    `SELECT lot_id, item_id, item_d, currency, price, created_at
     FROM market
     WHERE seller_id=?
     ORDER BY lot_id DESC
     LIMIT ? OFFSET ?`,
    [id, PAGE_SIZE, offset],
    (err, rows) => {
      const lots = rows || [];

      return getUserLang(db, id).then((lang) => {
        if (!lots.length) {
          return bot.sendMessage(id, t(lang, "market.my_empty"), {
            parse_mode: "HTML",
            reply_markup: menuKb(prefix, lang),
          });
        }

        const lines = lots.map((l, i) => {
          const itemText = formatLine(l.item_id, Number(l.item_d || 10));
          const cur = l.currency === "tokens" ? "💠" : "🪙";
          return t(lang, "market.my_line", {
            index: i + 1,
            item: itemText,
            price: l.price,
            cur,
            lotId: l.lot_id,
          });
        });

        const ik = lots.map((l, i) => [
          { text: t(lang, "market.unlist_button", { index: i + 1 }), callback_data: `${prefix}_unlist_${l.lot_id}` },
        ]);

      const nav = [];
      if (page > 0) nav.push({ text: "⬅️", callback_data: `${prefix}_my_${page - 1}` });
      nav.push({ text: `📄 ${page + 1}`, callback_data: `${prefix}_noop` });
      nav.push({ text: "➡️", callback_data: `${prefix}_my_${page + 1}` });
      ik.push(nav);

        ik.push([{ text: t(lang, "market.menu_market"), callback_data: `${prefix}_menu` }]);

        bot.sendMessage(id, t(lang, "market.my_title", { lines: lines.join("\n\n") }), {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: ik },
        });
      });
    }
  );
}

function renderPickSell(bot, id, userState, prefix) {
  db.get("SELECT accessories FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return;
    const inv = normalizeInv(u.accessories);

    const lang = resolveLang(u.lang);
    if (!inv.length) {
      return bot.sendMessage(id, t(lang, "market.inventory_empty"), {
        parse_mode: "HTML",
        reply_markup: menuKb(prefix, lang),
      });
    }

    const items = inv
      .filter((x) => x && x.id)
      .map((x) => ({ id: x.id, d: Number.isFinite(x.d) ? x.d : 10 }))
      .filter((x) => x.d > 0);

    if (!items.length) {
      return bot.sendMessage(id, t(lang, "market.inventory_broken"), {
        parse_mode: "HTML",
        reply_markup: menuKb(prefix, lang),
      });
    }

    const st = ensureState(userState, id);
    st.sellPick = items;

    const lines = items.slice(0, 25).map((it, i) => {
      const sys = priceToSystem(it.id, it.d);
      const sp = shopPrice(it.id);
      const shopText = sp ? t(lang, "market.system_price_shop", { shop: sp }) : "";
      return `${i + 1}. ${formatLine(it.id, it.d)}\n   ${t(lang, "market.system_price", { sys, shop: shopText })}`;
    });

    const ik = items.slice(0, 25).map((_, i) => [
      { text: t(lang, "market.pick_button", { index: i + 1 }), callback_data: `${prefix}_pick_${i}` },
    ]);
    ik.push([{ text: t(lang, "market.menu_market"), callback_data: `${prefix}_menu` }]);

    bot.sendMessage(id, t(lang, "market.pick_item_title", { lines: lines.join("\n\n") }), {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: ik },
    });
  });
}

function renderPickCurrency(bot, id, userState, prefix, item) {
  const sys = priceToSystem(item.id, item.d);
  const sp = shopPrice(item.id);
  const st = ensureState(userState, id);
  st.pending = { item };

  getUserLang(db, id).then((lang) => {
    const shopText = sp ? t(lang, "market.price_hint_shop", { shop: sp }) : "";
    bot.sendMessage(
      id,
      t(lang, "market.list_title", { item: formatLine(item.id, item.d) }) +
        `\n\n${t(lang, "market.price_hint", { sys, shop: shopText })}\n\n` +
        `${t(lang, "market.choose_currency")}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🪙 Coins", callback_data: `${prefix}_cur_coins` }],
            [{ text: "💠 Tokens", callback_data: `${prefix}_cur_tokens` }],
            [{ text: t(lang, "common.back"), callback_data: `${prefix}_sell_pick` }],
          ],
        },
      }
    );
  });
}

function askPrice(bot, id, userState, prefix, currency) {
  const st = ensureState(userState, id);
  if (!st.pending?.item) return sendMarketMenu(bot, id, userState, prefix);

  st.pending.currency = currency;

  userState[id].step = `${prefix}_price`; // mkt_price / pm_price
  getUserLang(db, id).then((lang) => {
    const currencyText = currency === "tokens" ? "💠 tokens" : "🪙 coins";
    bot.sendMessage(
      id,
      t(lang, "market.ask_price", {
        currency: currencyText,
        item: formatLine(st.pending.item.id, st.pending.item.d),
      }),
      { parse_mode: "HTML" }
    );
  });
}

// ---------- ACTIONS ----------
function buyLot(bot, id, prefix, lotId) {
  const lid = toInt(lotId, -1);
  if (lid <= 0) return;

  db.get("SELECT * FROM market WHERE lot_id=?", [lid], (e1, lot) => {
    if (!lot) {
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "market.lot_not_found"), { reply_markup: menuKb(prefix, lang) })
      );
    }

    if (Number(lot.seller_id) === Number(id)) {
      return getUserLang(db, id).then((lang) =>
        bot.answerCallbackQuery?.(id, { text: t(lang, "market.own_lot") }).catch(() => {})
      );
    }

    db.get("SELECT * FROM users WHERE id=?", [id], (e2, buyer) => {
      if (!buyer) return;

      const price = Number(lot.price || 0);
      const cur = lot.currency === "tokens" ? "tokens" : "coins";

      const buyerCoins = Number(buyer.coins || 0);
      const buyerTokens = Number(buyer.tokens || 0);

      if (cur === "coins" && buyerCoins < price) {
        return getUserLang(db, id).then((lang) =>
          bot.sendMessage(id, t(lang, "market.no_coins"), { reply_markup: menuKb(prefix, lang) })
        );
      }
      if (cur === "tokens" && buyerTokens < price) {
        return getUserLang(db, id).then((lang) =>
          bot.sendMessage(id, t(lang, "market.no_tokens"), { reply_markup: menuKb(prefix, lang) })
        );
      }

      // seller exists?
      db.get("SELECT id FROM users WHERE id=?", [lot.seller_id], (e3, seller) => {
        if (!seller) {
          return getUserLang(db, id).then((lang) =>
            bot.sendMessage(id, t(lang, "market.seller_not_found"), { reply_markup: menuKb(prefix, lang) })
          );
        }

        const inv = normalizeInv(buyer.accessories);
        addItem(inv, lot.item_id, Number(lot.item_d || 10));

        const buyerUpdate =
          cur === "coins"
            ? "UPDATE users SET coins=coins-?, accessories=? WHERE id=?"
            : "UPDATE users SET tokens=tokens-?, accessories=? WHERE id=?";

        const sellerUpdate =
          cur === "coins"
            ? "UPDATE users SET coins=coins+? WHERE id=?"
            : "UPDATE users SET tokens=tokens+? WHERE id=?";

        db.serialize(() => {
          db.run("BEGIN TRANSACTION");

          db.run(buyerUpdate, [price, JSON.stringify(inv), id], (x1) => {
            if (x1) return db.run("ROLLBACK");

            db.run(sellerUpdate, [price, lot.seller_id], (x2) => {
              if (x2) return db.run("ROLLBACK");

              db.run("DELETE FROM market WHERE lot_id=?", [lid], (x3) => {
                if (x3) return db.run("ROLLBACK");
                db.run("COMMIT", () => {
                  getUserLang(db, id).then((lang) => {
                    const curText = cur === "tokens" ? "💠" : "🪙";
                    bot.sendMessage(
                      id,
                      t(lang, "market.buy_ok", {
                        item: formatLine(lot.item_id, lot.item_d),
                        price,
                        cur: curText,
                      }),
                      { parse_mode: "HTML" }
                    );
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

function unlistLot(bot, id, userState, prefix, lotId) {
  const lid = toInt(lotId, -1);
  if (lid <= 0) return;

  db.get("SELECT * FROM market WHERE lot_id=?", [lid], (e1, lot) => {
    if (!lot) {
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "market.lot_not_found"), { reply_markup: menuKb(prefix, lang) })
      );
    }
    if (Number(lot.seller_id) !== Number(id)) {
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "market.not_your_lot"), { reply_markup: menuKb(prefix, lang) })
      );
    }

    db.get("SELECT accessories FROM users WHERE id=?", [id], (e2, u) => {
      if (!u) return;

      const inv = normalizeInv(u.accessories);
      addItem(inv, lot.item_id, Number(lot.item_d || 10));

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run("DELETE FROM market WHERE lot_id=?", [lid], (x1) => {
          if (x1) return db.run("ROLLBACK");
          db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), id], (x2) => {
            if (x2) return db.run("ROLLBACK");
            db.run("COMMIT", () => {
              getUserLang(db, id).then((lang) => {
                bot.sendMessage(
                  id,
                  t(lang, "market.unlist_ok", { item: formatLine(lot.item_id, lot.item_d) }),
                  {
                    parse_mode: "HTML",
                    reply_markup: menuKb(prefix, lang),
                  }
                );
              });
            });
          });
        });
      });
    });
  });
}

// ---------- INPUT (price) ----------
function handleInput(bot, msg, userState) {
  const id = msg.chat.id;
  const st = userState?.[id];
  if (!st?.step) return false;

  const step = String(st.step);
  if (!(step.startsWith("mkt_") || step.startsWith("pm_"))) return false;

  const prefix = step.startsWith("pm_") ? "pm" : "mkt";
  if (!step.endsWith("_price")) return false;

  const price = toInt((msg.text || "").trim(), -1);
  if (price <= 0) {
    getUserLang(db, id).then((lang) => bot.sendMessage(id, t(lang, "errors.invalid_price")));
    return true;
  }

  const m = ensureState(userState, id);
  const pending = m.pending;
  if (!pending?.item || !pending.currency) {
    st.step = null;
    getUserLang(db, id).then((lang) =>
      bot.sendMessage(id, t(lang, "market.no_pending"), { reply_markup: menuKb(prefix, lang) })
    );
    return true;
  }

  const item = pending.item;
  const d = Number(item.d || 10);

  // снимаем предмет из инвентаря и создаём лот
  db.get("SELECT accessories FROM users WHERE id=?", [id], (e1, u) => {
    if (!u) return;

    const inv = normalizeInv(u.accessories);

    // удаляем 1 экземпляр
    const ok = removeOneItem(inv, item.id);
    if (!ok) {
      st.step = null;
      getUserLang(db, id).then((lang) =>
      bot.sendMessage(id, t(lang, "market.item_missing"), { reply_markup: menuKb(prefix, lang) })
      );
      return;
    }

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), id], (x1) => {
        if (x1) return db.run("ROLLBACK");

        db.run(
          "INSERT INTO market (seller_id, item_id, item_d, currency, price, created_at) VALUES (?, ?, ?, ?, ?, strftime('%s','now'))",
          [id, item.id, d, pending.currency, price],
          (x2) => {
            if (x2) return db.run("ROLLBACK");
            db.run("COMMIT", () => {
              st.step = null;
              m.pending = null;
              getUserLang(db, id).then((lang) => {
                const curText = pending.currency === "tokens" ? "💠" : "🪙";
                bot.sendMessage(
                  id,
                  t(lang, "market.list_ok", {
                    item: formatLine(item.id, d),
                    price,
                    cur: curText,
                  }),
                  { parse_mode: "HTML", reply_markup: menuKb(prefix, lang) }
                );
              });
            });
          }
        );
      });
    });
  });

  return true;
}

// ---------- CALLBACKS ----------
function handleMarketCallback(bot, q, userState) {
  const id = q.message.chat.id;
  const data = q.data || "";
  const prefix = getPrefix(data);

  if (data === `${prefix}_noop`) return;

  if (data === `${prefix}_menu` || data === "pm_menu" || data === "mkt_menu") {
    return sendMarketMenu(bot, id, userState, prefix);
  }

  if (data === `${prefix}_back`) {
    return getUserLang(db, id).then((lang) =>
      bot.sendMessage(id, t(lang, "menu.main_title"), require("../../ui/keyboards").mainMenu(lang))
    );
  }

  if (data.startsWith(`${prefix}_list_`)) {
    const page = toInt(data.replace(`${prefix}_list_`, ""), 0);
    return renderLots(bot, id, prefix, Math.max(0, page));
  }

  if (data.startsWith(`${prefix}_my_`)) {
    const page = toInt(data.replace(`${prefix}_my_`, ""), 0);
    return renderMyLots(bot, id, prefix, Math.max(0, page));
  }

  if (data === `${prefix}_sell_pick`) {
    return renderPickSell(bot, id, userState, prefix);
  }

  if (data.startsWith(`${prefix}_pick_`)) {
    const idx = toInt(data.replace(`${prefix}_pick_`, ""), -1);
    const st = ensureState(userState, id);
    const item = st.sellPick?.[idx];
    if (!item) {
      return getUserLang(db, id).then((lang) =>
        bot.sendMessage(id, t(lang, "market.pick_missing"), { reply_markup: menuKb(prefix, lang) })
      );
    }
    return renderPickCurrency(bot, id, userState, prefix, item);
  }

  if (data === `${prefix}_cur_coins`) return askPrice(bot, id, userState, prefix, "coins");
  if (data === `${prefix}_cur_tokens`) return askPrice(bot, id, userState, prefix, "tokens");

  if (data.startsWith(`${prefix}_buy_`)) {
    const lotId = toInt(data.replace(`${prefix}_buy_`, ""), -1);
    return buyLot(bot, id, prefix, lotId);
  }

  if (data.startsWith(`${prefix}_unlist_`)) {
    const lotId = toInt(data.replace(`${prefix}_unlist_`, ""), -1);
    return unlistLot(bot, id, userState, prefix, lotId);
  }
}

// API for index.js
module.exports = {
  sendMarketMenu,
  handleMarketCallback,
  handleInput,
};
