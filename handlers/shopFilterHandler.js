// handlers/shopFilterHandler.js
const db = require("../database/db");
const shopRaw = require("../data/shop");
const tools = require("../data/tools");
const { normalizeInv, addItem } = require("../utils/inventory");
const kb = require("../ui/keyboards");
const energy = require("../utils/energy");

function normalizeShop(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    return Object.values(raw).filter(Boolean);
  }
  return [];
}

const SHOP = normalizeShop(shopRaw);

const RARITIES = ["all", "common", "rare", "epic", "legendary"];
const SORTS = ["price_asc", "price_desc", "name_asc"];
const PAGE_SIZE = 8;

function getPrefs(userState, id) {
  const base = { tab: "items", rarity: "all", sort: "price_asc", page: 0 };
  const cur = userState?.[id]?.shopPrefs || {};
  return { ...base, ...cur };
}

function setPrefs(userState, id, patch) {
  userState[id] = userState[id] || {};
  userState[id].shopPrefs = { ...getPrefs(userState, id), ...(patch || {}) };
}

function sortLabel(s) {
  if (s === "price_asc") return "💰 Дешевле";
  if (s === "price_desc") return "💎 Дороже";
  if (s === "name_asc") return "🔤 A→Z";
  return s;
}

function applyFilterAndSort(items, prefs) {
  let list = items.slice();

  if (prefs.rarity !== "all") list = list.filter((x) => x && x.rarity === prefs.rarity);

  if (prefs.sort === "price_asc") list.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  else if (prefs.sort === "price_desc") list.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
  else if (prefs.sort === "name_asc") list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));

  return list;
}

function buildTabRow(prefs) {
  return [
    { text: (prefs.tab === "items" ? "✅ " : "") + "🛍 Товары", callback_data: "shopf_tab_items" },
    { text: (prefs.tab === "tools" ? "✅ " : "") + "🧰 Tools", callback_data: "shopf_tab_tools" },
  ];
}

function buildEnergyRow() {
  return [
    { text: "⚡ +1 за 50🪙", callback_data: "shopf_energy_1" },
    { text: "⚡ FULL за 10💠", callback_data: "shopf_energy_full" },
  ];
}

function buildItemsKeyboard(slice, prefs, page, maxPage) {
  const rarityRow = RARITIES.map((r) => ({
    text: (prefs.rarity === r ? "✅ " : "") + (r === "all" ? "ВСЕ" : r.toUpperCase()),
    callback_data: `shopf_r_${r}`,
  }));

  const sortRow = SORTS.map((s) => ({
    text: (prefs.sort === s ? "✅ " : "") + sortLabel(s),
    callback_data: `shopf_s_${s}`,
  }));

  const itemRows = slice.map((it) => [{ text: `Купить: ${it.name} — ${it.price} 🪙`, callback_data: `shopf_buy_${it.id}` }]);

  const nav = [];
  if (maxPage > 0) {
    if (page > 0) nav.push({ text: "⬅️", callback_data: `shopf_p_${page - 1}` });
    nav.push({ text: `${page + 1}/${maxPage + 1}`, callback_data: "shopf_noop" });
    if (page < maxPage) nav.push({ text: "➡️", callback_data: `shopf_p_${page + 1}` });
  }

  const rows = [buildTabRow(prefs), buildEnergyRow(), rarityRow, sortRow, ...itemRows];
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🔙 В меню", callback_data: "shopf_back" }]);

  return { inline_keyboard: rows };
}

function buildToolsKeyboard(slice, prefs, page, maxPage) {
  const toolRows = slice.map((t) => [{ text: `Купить: ${t.name} — ${t.tokenPrice} 💠`, callback_data: `shopf_buytool_${t.id}` }]);

  const nav = [];
  if (maxPage > 0) {
    if (page > 0) nav.push({ text: "⬅️", callback_data: `shopf_tp_${page - 1}` });
    nav.push({ text: `${page + 1}/${maxPage + 1}`, callback_data: "shopf_noop" });
    if (page < maxPage) nav.push({ text: "➡️", callback_data: `shopf_tp_${page + 1}` });
  }

  const rows = [buildTabRow(prefs), buildEnergyRow(), ...toolRows];
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🔙 В меню", callback_data: "shopf_back" }]);

  return { inline_keyboard: rows };
}

function sendShop(bot, id, userState, mid = null) {
  db.get("SELECT coins, tokens, energy, energy_ts FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return;

    const prefs = getPrefs(userState, id);
    const coins = Number(u.coins || 0);
    const tokens = Number(u.tokens || 0);

    const synced = energy.syncEnergy(u.energy, u.energy_ts);
    const e = synced.energy;
    const ts = synced.energy_ts;

    if ((Number(u.energy) || 0) !== e || (Number(u.energy_ts) || 0) !== ts) {
      db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
    }

    const next = e >= energy.MAX_ENERGY ? "" : ` • next: ${energy.formatWait(energy.secondsToNext(e, ts))}`;

    let text = `🛒 <b>МАГАЗИН</b>\n`;
    text += `Баланс: 🪙 <b>${coins.toLocaleString()}</b> • 💠 <b>${tokens.toLocaleString()}</b>\n`;
    text += `⚡ <b>${e}/${energy.MAX_ENERGY}</b>${next}\n\n`;

    if (prefs.tab === "tools") {
      const list = tools.slice();
      const maxPage = Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1);
      const page = Math.max(0, Math.min(prefs.page, maxPage));
      const slice = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      text += `🧰 <b>TOOLS</b>\n\n`;
      text += slice.length ? slice.map((t, i) => `${i + 1}) <b>${t.name}</b> — 💠 <b>${t.tokenPrice}</b>`).join("\n") : "Пока пусто.";

      const opt = { parse_mode: "HTML", reply_markup: buildToolsKeyboard(slice, { ...prefs, page }, page, maxPage) };
      if (mid) return bot.editMessageText(text, { chat_id: id, message_id: mid, ...opt }).catch(() => {});
      return bot.sendMessage(id, text, opt);
    }

    const filtered = applyFilterAndSort(SHOP, prefs);
    const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
    const page = Math.max(0, Math.min(prefs.page, maxPage));
    const slice = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    text += `🛍 <b>ТОВАРЫ</b>\n\n`;
    text += slice.length ? slice.map((it, i) => `${i + 1}) <b>${it.name}</b> — 🪙 <b>${it.price}</b>`).join("\n") : "Пока пусто.";

    const opt = { parse_mode: "HTML", reply_markup: buildItemsKeyboard(slice, { ...prefs, page }, page, maxPage) };
    if (mid) return bot.editMessageText(text, { chat_id: id, message_id: mid, ...opt }).catch(() => {});
    return bot.sendMessage(id, text, opt);
  });
}

function handleCallbacks(bot, q, userState) {
  const id = q.message.chat.id;
  const mid = q.message.message_id;
  const data = q.data || "";

  if (data === "shopf_back") return bot.sendMessage(id, "🎮 Меню:", kb.mainMenu);
  if (data === "shopf_noop") return;

  // buy energy +1
  if (data === "shopf_energy_1") {
    db.get("SELECT coins, energy, energy_ts FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const synced = energy.syncEnergy(u.energy, u.energy_ts);
      let e = synced.energy;
      const ts = synced.energy_ts;

      if (e >= energy.MAX_ENERGY) {
        bot.answerCallbackQuery(q.id, { text: "⚡ Энергия уже полная!", show_alert: true }).catch(() => {});
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      if ((u.coins || 0) < 50) {
        bot.answerCallbackQuery(q.id, { text: "❌ Нужно 50🪙", show_alert: true }).catch(() => {});
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      e = Math.min(energy.MAX_ENERGY, e + 1);

      db.run("UPDATE users SET coins=coins-50, energy=?, energy_ts=? WHERE id=?", [e, ts, id], () => {
        bot.answerCallbackQuery(q.id, { text: `✅ +1⚡ (${e}/${energy.MAX_ENERGY})` }).catch(() => {});
        sendShop(bot, id, userState, mid);
      });
    });
    return;
  }

  // buy energy full
  if (data === "shopf_energy_full") {
    db.get("SELECT tokens, energy, energy_ts FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const synced = energy.syncEnergy(u.energy, u.energy_ts);
      let e = synced.energy;
      let ts = synced.energy_ts;

      if (e >= energy.MAX_ENERGY) {
        bot.answerCallbackQuery(q.id, { text: "⚡ Энергия уже полная!", show_alert: true }).catch(() => {});
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      if ((u.tokens || 0) < 10) {
        bot.answerCallbackQuery(q.id, { text: "❌ Нужно 10💠", show_alert: true }).catch(() => {});
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      e = energy.MAX_ENERGY;
      ts = energy.nowSec();

      db.run("UPDATE users SET tokens=tokens-10, energy=?, energy_ts=? WHERE id=?", [e, ts, id], () => {
        bot.answerCallbackQuery(q.id, { text: `✅ FULL⚡ (${e}/${energy.MAX_ENERGY})` }).catch(() => {});
        sendShop(bot, id, userState, mid);
      });
    });
    return;
  }

  // tabs
  if (data === "shopf_tab_items") {
    setPrefs(userState, id, { tab: "items", page: 0 });
    return sendShop(bot, id, userState, mid);
  }
  if (data === "shopf_tab_tools") {
    setPrefs(userState, id, { tab: "tools", page: 0, rarity: "all" });
    return sendShop(bot, id, userState, mid);
  }

  // tools pagination
  if (data.startsWith("shopf_tp_")) {
    const page = parseInt(data.replace("shopf_tp_", ""), 10) || 0;
    setPrefs(userState, id, { page, tab: "tools" });
    return sendShop(bot, id, userState, mid);
  }

  // items filters
  if (data.startsWith("shopf_r_")) {
    const rarity = data.replace("shopf_r_", "");
    if (!RARITIES.includes(rarity)) return;
    setPrefs(userState, id, { rarity, page: 0, tab: "items" });
    return sendShop(bot, id, userState, mid);
  }
  if (data.startsWith("shopf_s_")) {
    const sort = data.replace("shopf_s_", "");
    if (!SORTS.includes(sort)) return;
    setPrefs(userState, id, { sort, page: 0, tab: "items" });
    return sendShop(bot, id, userState, mid);
  }
  if (data.startsWith("shopf_p_")) {
    const page = parseInt(data.replace("shopf_p_", ""), 10) || 0;
    setPrefs(userState, id, { page, tab: "items" });
    return sendShop(bot, id, userState, mid);
  }

  // buy item (coins)
  if (data.startsWith("shopf_buy_")) {
    const itemId = data.replace("shopf_buy_", "");
    const item = SHOP.find((x) => x && x.id === itemId);
    if (!item) return bot.answerCallbackQuery(q.id, { text: "❌ Товар не найден." }).catch(() => {});

    db.get("SELECT coins, accessories FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;
      if ((u.coins || 0) < item.price) {
        return bot.answerCallbackQuery(q.id, { text: "❌ Мало монет!", show_alert: true }).catch(() => {});
      }

      const inv = normalizeInv(u.accessories);
      addItem(inv, item.id, 10);

      db.run("UPDATE users SET coins=coins-?, accessories=? WHERE id=?", [item.price, JSON.stringify(inv), id], () => {
        bot.answerCallbackQuery(q.id, { text: `✅ Куплено: ${item.name}` }).catch(() => {});
        sendShop(bot, id, userState, mid);
      });
    });
    return;
  }

  // buy tool (tokens)
  if (data.startsWith("shopf_buytool_")) {
    const toolId = data.replace("shopf_buytool_", "");
    const tool = tools.find((t) => t && t.id === toolId);
    if (!tool) return bot.answerCallbackQuery(q.id, { text: "❌ Tool не найден." }).catch(() => {});

    db.get("SELECT tokens, accessories FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;
      if ((u.tokens || 0) < tool.tokenPrice) {
        return bot.answerCallbackQuery(q.id, { text: "❌ Мало 💠 токенов!", show_alert: true }).catch(() => {});
      }

      const inv = normalizeInv(u.accessories);
      addItem(inv, tool.id, 10);

      db.run("UPDATE users SET tokens=tokens-?, accessories=? WHERE id=?", [tool.tokenPrice, JSON.stringify(inv), id], () => {
        bot.answerCallbackQuery(q.id, { text: `✅ Куплено: ${tool.name}` }).catch(() => {});
        sendShop(bot, id, userState, mid);
      });
    });
    return;
  }
}

module.exports = { sendShop, handleCallbacks };
