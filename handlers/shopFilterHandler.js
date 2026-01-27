// handlers/shopFilterHandler.js
const db = require("../database/db");
const shopRaw = require("../data/shop");
const tools = require("../data/tools");
const { normalizeInv, addItem } = require("../utils/inventory");
const kb = require("../ui/keyboards");
const energy = require("../utils/energy");
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

function sortLabel(s, lang) {
  if (s === "price_asc") return t(lang, "shop.sort_price_asc");
  if (s === "price_desc") return t(lang, "shop.sort_price_desc");
  if (s === "name_asc") return t(lang, "shop.sort_name_asc");
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

function buildTabRow(prefs, lang) {
  return [
    { text: (prefs.tab === "items" ? "✅ " : "") + t(lang, "shop.tab_items"), callback_data: "shopf_tab_items" },
    { text: (prefs.tab === "tools" ? "✅ " : "") + t(lang, "shop.tab_tools"), callback_data: "shopf_tab_tools" },
  ];
}

function buildEnergyRow(lang) {
  return [
    { text: t(lang, "shop.energy_one"), callback_data: "shopf_energy_1" },
    { text: t(lang, "shop.energy_full_button"), callback_data: "shopf_energy_full" },
  ];
}

function buildItemsKeyboard(slice, prefs, page, maxPage, lang) {
  const rarityRow = RARITIES.map((r) => ({
    text: (prefs.rarity === r ? "✅ " : "") + (r === "all" ? t(lang, "shop.rarity_all") : r.toUpperCase()),
    callback_data: `shopf_r_${r}`,
  }));

  const sortRow = SORTS.map((s) => ({
    text: (prefs.sort === s ? "✅ " : "") + sortLabel(s, lang),
    callback_data: `shopf_s_${s}`,
  }));

  const itemRows = slice.map((it) => [{ text: t(lang, "shop.buy_item", { item: it.name, price: it.price }), callback_data: `shopf_buy_${it.id}` }]);

  const nav = [];
  if (maxPage > 0) {
    if (page > 0) nav.push({ text: "⬅️", callback_data: `shopf_p_${page - 1}` });
    nav.push({ text: `${page + 1}/${maxPage + 1}`, callback_data: "shopf_noop" });
    if (page < maxPage) nav.push({ text: "➡️", callback_data: `shopf_p_${page + 1}` });
  }

  const rows = [buildTabRow(prefs, lang), buildEnergyRow(lang), rarityRow, sortRow, ...itemRows];
  if (nav.length) rows.push(nav);
  rows.push([{ text: t(lang, "menu.back"), callback_data: "shopf_back" }]);

  return { inline_keyboard: rows };
}

function buildToolsKeyboard(slice, prefs, page, maxPage, lang) {
  const toolRows = slice.map((tool) => [{ text: t(lang, "shop.buy_tool", { item: tool.name, price: tool.tokenPrice }), callback_data: `shopf_buytool_${tool.id}` }]);

  const nav = [];
  if (maxPage > 0) {
    if (page > 0) nav.push({ text: "⬅️", callback_data: `shopf_tp_${page - 1}` });
    nav.push({ text: `${page + 1}/${maxPage + 1}`, callback_data: "shopf_noop" });
    if (page < maxPage) nav.push({ text: "➡️", callback_data: `shopf_tp_${page + 1}` });
  }

  const rows = [buildTabRow(prefs, lang), buildEnergyRow(lang), ...toolRows];
  if (nav.length) rows.push(nav);
  rows.push([{ text: t(lang, "menu.back"), callback_data: "shopf_back" }]);

  return { inline_keyboard: rows };
}

function sendShop(bot, id, userState, mid = null) {
  db.get("SELECT coins, tokens, energy, energy_ts, lang FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return;
    const lang = resolveLang(u.lang);

    const prefs = getPrefs(userState, id);
    const coins = Number(u.coins || 0);
    const tokens = Number(u.tokens || 0);

    const synced = energy.syncEnergy(u.energy, u.energy_ts);
    const e = synced.energy;
    const ts = synced.energy_ts;

    if ((Number(u.energy) || 0) !== e || (Number(u.energy_ts) || 0) !== ts) {
      db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
    }

    const next = e >= energy.MAX_ENERGY ? "" : ` • ${t(lang, "shop.energy_next", { next: energy.formatWait(energy.secondsToNext(e, ts)) })}`;

    let text = `${t(lang, "shop.title")}\n`;
    text += `${t(lang, "shop.balance", { coins: coins.toLocaleString(), tokens: tokens.toLocaleString() })}\n`;
    text += `⚡ <b>${e}/${energy.MAX_ENERGY}</b>${next}\n\n`;

    if (prefs.tab === "tools") {
      const list = tools.slice();
      const maxPage = Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1);
      const page = Math.max(0, Math.min(prefs.page, maxPage));
      const slice = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      text += `${t(lang, "shop.tools_title")}\n\n`;
      text += slice.length ? slice.map((t, i) => `${i + 1}) <b>${t.name}</b> — 💠 <b>${t.tokenPrice}</b>`).join("\n") : t(lang, "profile.empty");

      const opt = { parse_mode: "HTML", reply_markup: buildToolsKeyboard(slice, { ...prefs, page }, page, maxPage, lang) };
      if (mid) return bot.editMessageText(text, { chat_id: id, message_id: mid, ...opt }).catch(() => {});
      return bot.sendMessage(id, text, opt);
    }

    const filtered = applyFilterAndSort(SHOP, prefs);
    const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
    const page = Math.max(0, Math.min(prefs.page, maxPage));
    const slice = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    text += `${t(lang, "shop.items_title")}\n\n`;
    text += slice.length ? slice.map((it, i) => `${i + 1}) <b>${it.name}</b> — 🪙 <b>${it.price}</b>`).join("\n") : t(lang, "profile.empty");

    const opt = { parse_mode: "HTML", reply_markup: buildItemsKeyboard(slice, { ...prefs, page }, page, maxPage, lang) };
    if (mid) return bot.editMessageText(text, { chat_id: id, message_id: mid, ...opt }).catch(() => {});
    return bot.sendMessage(id, text, opt);
  });
}

function handleCallbacks(bot, q, userState) {
  const id = q.message.chat.id;
  const mid = q.message.message_id;
  const data = q.data || "";

  if (data === "shopf_back") {
    return getUserLang(db, id).then((lang) => bot.sendMessage(id, t(lang, "menu.main_title"), kb.mainMenu(lang)));
  }
  if (data === "shopf_noop") return;

  // buy energy +1
  if (data === "shopf_energy_1") {
    db.get("SELECT coins, energy, energy_ts FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const synced = energy.syncEnergy(u.energy, u.energy_ts);
      let e = synced.energy;
      const ts = synced.energy_ts;

      if (e >= energy.MAX_ENERGY) {
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.energy_full"), show_alert: true }).catch(() => {})
        );
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      if ((u.coins || 0) < 50) {
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.need_coins"), show_alert: true }).catch(() => {})
        );
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      e = Math.min(energy.MAX_ENERGY, e + 1);

      db.run("UPDATE users SET coins=coins-50, energy=?, energy_ts=? WHERE id=?", [e, ts, id], () => {
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.energy_plus_one", { cur: e, max: energy.MAX_ENERGY }) }).catch(() => {})
        );
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
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.energy_full"), show_alert: true }).catch(() => {})
        );
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      if ((u.tokens || 0) < 10) {
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.need_tokens"), show_alert: true }).catch(() => {})
        );
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
        return sendShop(bot, id, userState, mid);
      }

      e = energy.MAX_ENERGY;
      ts = energy.nowSec();

      db.run("UPDATE users SET tokens=tokens-10, energy=?, energy_ts=? WHERE id=?", [e, ts, id], () => {
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.energy_full_purchase", { cur: e, max: energy.MAX_ENERGY }) }).catch(() => {})
        );
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
    if (!item) {
      return getUserLang(db, id).then((lang) =>
        bot.answerCallbackQuery(q.id, { text: t(lang, "shop.item_not_found") }).catch(() => {})
      );
    }

    db.get("SELECT coins, accessories FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;
      if ((u.coins || 0) < item.price) {
        return getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.not_enough_coins"), show_alert: true }).catch(() => {})
        );
      }

      const inv = normalizeInv(u.accessories);
      addItem(inv, item.id, 10);

      db.run("UPDATE users SET coins=coins-?, accessories=? WHERE id=?", [item.price, JSON.stringify(inv), id], () => {
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.bought_item", { item: item.name }) }).catch(() => {})
        );
        sendShop(bot, id, userState, mid);
      });
    });
    return;
  }

  // buy tool (tokens)
  if (data.startsWith("shopf_buytool_")) {
    const toolId = data.replace("shopf_buytool_", "");
    const tool = tools.find((t) => t && t.id === toolId);
    if (!tool) {
      return getUserLang(db, id).then((lang) =>
        bot.answerCallbackQuery(q.id, { text: t(lang, "shop.tool_not_found") }).catch(() => {})
      );
    }

    db.get("SELECT tokens, accessories FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;
      if ((u.tokens || 0) < tool.tokenPrice) {
        return getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.not_enough_tokens"), show_alert: true }).catch(() => {})
        );
      }

      const inv = normalizeInv(u.accessories);
      addItem(inv, tool.id, 10);

      db.run("UPDATE users SET tokens=tokens-?, accessories=? WHERE id=?", [tool.tokenPrice, JSON.stringify(inv), id], () => {
        getUserLang(db, id).then((lang) =>
          bot.answerCallbackQuery(q.id, { text: t(lang, "shop.bought_item", { item: tool.name }) }).catch(() => {})
        );
        sendShop(bot, id, userState, mid);
      });
    });
    return;
  }
}

module.exports = { sendShop, handleCallbacks };
