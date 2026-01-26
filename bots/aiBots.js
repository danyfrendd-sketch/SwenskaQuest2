// bots/aiBots.js
const lessons = require("../data/lessons");
const tools = require("../data/tools");
const chests = require("../data/chests");

const energy = require("../utils/energy");
const { normalizeInv, normalizeEquipped, addItem, removeOneItem, decDurability } = require("../utils/inventory");
const pricing = require("../utils/pricing");
const activity = require("../utils/activityLog");

// ---- SAFE wrappers ----
function priceToSystemSafe(id, d) {
  try {
    return typeof pricing.priceToSystem === "function" ? pricing.priceToSystem(id, d) : 1;
  } catch {
    return 1;
  }
}
function shopPriceSafe(id) {
  try {
    if (typeof pricing.shopPrice === "function") return pricing.shopPrice(id);
  } catch {}
  // fallback: читать цену из data/shop напрямую
  try {
    const shopRaw = require("../data/shop");
    const arr = Array.isArray(shopRaw)
      ? shopRaw
      : shopRaw && typeof shopRaw === "object"
      ? Array.isArray(shopRaw.items)
        ? shopRaw.items
        : Object.values(shopRaw).filter(Boolean)
      : [];
    const it = arr.find((x) => x && x.id === id);
    const p = Number(it?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

// ---- Bots ----
const BOT_PLAYERS = [
  { id: -101, name: "Смурфик", avatar: "🧿", age: 18 },
  { id: -102, name: "Шнеля", avatar: "⚡️", age: 19 },
  { id: -103, name: "Mactraher", avatar: "🦊", age: 20 },
];

// ---- helpers ----
function rint(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
function chance(p) {
  return Math.random() < p;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function safeParse(v, def) {
  try {
    return JSON.parse(v || "");
  } catch {
    return def;
  }
}
function now() {
  return energy.nowSec();
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// ---- runtime state ----
const runtime = new Map();
function getRt(id) {
  if (!runtime.has(id)) {
    runtime.set(id, {
      burstLeft: rint(3, 7),
      pauseLeft: rint(0, 2),
      mood: Math.random(),
      // ✅ боты копят до случайной цели (6..MAX)
      energyTarget: rint(6, energy.MAX_ENERGY),
      // ✅ анти-спам рынка
      nextTradeAt: 0,
      // ✅ анти-спам покупок энергии
      nextEnergyBuyAt: 0,
      // ✅ анти-спам переэкипировки
      nextEquipAt: 0,
    });
  }
  return runtime.get(id);
}
function rerollCycle(rt) {
  rt.burstLeft = rint(3, 8);
  rt.pauseLeft = chance(0.35) ? rint(1, 4) : 0;
  rt.mood = Math.random();
  if (chance(0.35)) rt.energyTarget = rint(6, energy.MAX_ENERGY);
}

// ---- trader knobs (без миллионов/миллиардов) ----
const COINS_RESERVE = 80;
const TOKENS_RESERVE = 2;
const MAX_COIN_PRICE = 2500;
const MAX_TOKEN_PRICE = 25;
const MIN_PROFIT_PCT = 0.12;
const TRADE_COOLDOWN_SEC = 40;

// ---- energy shop knobs ----
const ENERGY_BUY_ONE_COST = 50; // 🪙
const ENERGY_BUY_FULL_COST = 10; // 💠
const ENERGY_BUY_COOLDOWN_SEC = 6 * 60; // базовый кулдаун

// ---- equip knobs ----
const EQUIP_COOLDOWN_SEC = 5 * 60;

function clampPriceCoins(p) {
  const n = Math.floor(Number(p) || 0);
  return clamp(n, 1, MAX_COIN_PRICE);
}
function clampPriceTokens(p) {
  const n = Math.floor(Number(p) || 0);
  return clamp(n, 1, MAX_TOKEN_PRICE);
}

function ensureBots(db) {
  for (const b of BOT_PLAYERS) {
    db.get("SELECT id FROM users WHERE id=?", [b.id], (err, row) => {
      if (row) return;

      const startCoins = 200;
      const startTokens = 10;

      db.run(
        `INSERT INTO users (id, name, age, avatar, coins, tokens, xp, level, current_lesson, current_task, accessories, chests, keys, equipped, audio_enabled, energy, energy_ts)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1, 0, '[]', '[]', '[]', '{}', 0, ?, ?)`,
        [b.id, b.name, b.age, b.avatar, startCoins, startTokens, energy.MAX_ENERGY, now()],
        () => activity.log(b.id, "bot_spawn", { name: b.name })
      );
    });
  }
}

function syncUserEnergy(u) {
  const synced = energy.syncEnergy(u.energy, u.energy_ts);
  return { e: synced.energy, ts: synced.energy_ts };
}

function calcLogicalMarketPrice(itemId, d) {
  const sys = priceToSystemSafe(itemId, d);
  const sp = shopPriceSafe(itemId);

  if (sp) {
    const low = Math.ceil(sys * (1.2 + Math.random() * 0.5));
    const high = Math.floor(sp * (0.95 + Math.random() * 0.05));
    if (high <= low) return clampPriceCoins(clamp(low, sys, sp));
    return clampPriceCoins(clamp(rint(low, high), sys, sp));
  }

  const low = Math.ceil(sys * (1.3 + Math.random() * 0.6));
  const high = Math.ceil(sys * (2.2 + Math.random() * 0.9));
  return clampPriceCoins(Math.max(sys, rint(low, high)));
}

// -----------------------------
// ENERGY BUY (по желанию)
// -----------------------------
function botMaybeBuyEnergy(db, userId) {
  const rt = getRt(userId);
  if (now() < (rt.nextEnergyBuyAt || 0)) return;

  db.get("SELECT coins, tokens, energy, energy_ts FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const synced = energy.syncEnergy(u.energy, u.energy_ts);
    const e = synced.energy;
    const ts = synced.energy_ts;

    // синк
    if ((Number(u.energy) || 0) !== e || (Number(u.energy_ts) || 0) !== ts) {
      db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, userId]);
    }

    if (e >= energy.MAX_ENERGY) return;

    const coins = Number(u.coins || 0);
    const tokens = Number(u.tokens || 0);

    const target = rt.energyTarget || rint(6, energy.MAX_ENERGY);
    rt.energyTarget = target;

    const gap = Math.max(0, target - e);
    const desireOne = clamp(0.10 + gap * 0.04 + (e === 0 ? 0.10 : 0), 0, 0.55);
    const desireFull = clamp((e <= 1 ? 0.10 : e <= 3 ? 0.05 : 0.0) + (gap >= 10 ? 0.03 : 0), 0, 0.18);

    // FULL за токены (редко)
    if (
      e < energy.MAX_ENERGY &&
      tokens >= ENERGY_BUY_FULL_COST + TOKENS_RESERVE &&
      desireFull > 0 &&
      chance(desireFull)
    ) {
      db.run(
        "UPDATE users SET tokens=tokens-?, energy=?, energy_ts=? WHERE id=?",
        [ENERGY_BUY_FULL_COST, energy.MAX_ENERGY, now(), userId],
        () => {
          rt.nextEnergyBuyAt = now() + ENERGY_BUY_COOLDOWN_SEC + rint(0, 6 * 60);
          activity.log(userId, "energy_buy_full", { cost: ENERGY_BUY_FULL_COST, e_from: e, e_to: energy.MAX_ENERGY });
        }
      );
      return;
    }

    // +1 за монеты (чаще)
    if (
      e < energy.MAX_ENERGY &&
      e < target &&
      coins >= ENERGY_BUY_ONE_COST + COINS_RESERVE &&
      chance(desireOne)
    ) {
      const nextE = Math.min(energy.MAX_ENERGY, e + 1);
      db.run(
        "UPDATE users SET coins=coins-?, energy=?, energy_ts=? WHERE id=?",
        [ENERGY_BUY_ONE_COST, nextE, now(), userId],
        () => {
          rt.nextEnergyBuyAt = now() + Math.floor(ENERGY_BUY_COOLDOWN_SEC * 0.6) + rint(0, 5 * 60);
          activity.log(userId, "energy_buy_1", { cost: ENERGY_BUY_ONE_COST, e_from: e, e_to: nextE, target });
        }
      );
    }
  });
}

// -----------------------------
// TOOLS + AUTO-EQUIP (умно)
// -----------------------------
const TOOL_MAP = new Map();
for (const t of tools) {
  if (t && t.id) TOOL_MAP.set(String(t.id), t);
}
function toolEffect(toolId) {
  return TOOL_MAP.get(String(toolId || ""))?.effect || null;
}
function toolDurCost(toolId) {
  const c = parseInt(String(TOOL_MAP.get(String(toolId || ""))?.durabilityCost), 10);
  return Number.isFinite(c) && c > 0 ? c : 1;
}
function canUseTool(inv, toolId) {
  if (!toolId) return false;
  const it = inv.find((x) => x && String(x.id) === String(toolId));
  const d = it ? (Number.isFinite(it.d) ? it.d : 10) : 0;
  return d > 0;
}
function isToolId(id) {
  return /^t\d+$/i.test(String(id || ""));
}

// чем выше — тем желаннее
function toolPriority(effectKey) {
  switch (effectKey) {
    case "tool_show_answer": return 100;
    case "tool_remove_2": return 90;
    case "tool_retry_once": return 80;
    case "tool_remove_1": return 70;
    case "tool_hint_first_letter": return 55;
    case "tool_skip_free": return 50;
    case "tool_shuffle_options": return 35;
    case "tool_mark_suspect": return 20;
    case "tool_repeat_audio": return 10;
    default: return 5;
  }
}

function pickBestToolFromInv(inv) {
  const candidates = (inv || [])
    .filter((x) => x && x.id && isToolId(x.id))
    .map((x) => {
      const id = String(x.id);
      const d = Number.isFinite(x.d) ? x.d : 10;
      const eff = toolEffect(id);
      const tp = toolPriority(eff);
      return { id, d, eff, tp };
    })
    .filter((x) => x.eff && x.d > 0);

  if (!candidates.length) return null;

  // при равном приоритете — предпочитаем более прочный
  candidates.sort((a, b) => (b.tp - a.tp) || (b.d - a.d));
  return candidates[0].id;
}

function botEnsureToolEquipped(db, userId, u, inv) {
  const rt = getRt(userId);
  if (now() < (rt.nextEquipAt || 0)) return;

  const eq = normalizeEquipped(u.equipped);
  const cur = eq.tool;

  const curOk = cur && isToolId(cur) && toolEffect(cur) && canUseTool(inv, cur);
  if (curOk) return;

  const best = pickBestToolFromInv(inv);
  if (!best) {
    if (eq.tool) {
      eq.tool = null;
      db.run("UPDATE users SET equipped=? WHERE id=?", [JSON.stringify(eq), userId], () => {
        rt.nextEquipAt = now() + EQUIP_COOLDOWN_SEC + rint(0, 180);
        activity.log(userId, "equip_tool", { tool: null, reason: "no_tools" });
      });
    }
    return;
  }

  if (best !== eq.tool) {
    eq.tool = best;
    db.run("UPDATE users SET equipped=? WHERE id=?", [JSON.stringify(eq), userId], () => {
      rt.nextEquipAt = now() + EQUIP_COOLDOWN_SEC + rint(0, 180);
      activity.log(userId, "equip_tool", { tool: best, reason: cur ? "replace_or_broken" : "empty" });
    });
  }
}

// -----------------------------
// LESSON ACTION (с учетом цели энергии + тулсов)
// -----------------------------
function botDoLesson(db, userId) {
  db.get("SELECT * FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const rt = getRt(userId);

    // 1) синк энергии
    const synced = energy.syncEnergy(u.energy, u.energy_ts);
    let e = synced.energy;
    let ts = synced.energy_ts;

    if ((Number(u.energy) || 0) !== e || (Number(u.energy_ts) || 0) !== ts) {
      db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, userId]);
    }

    // 2) подготовка инвентаря + авто-экип TOOL
    const inv = normalizeInv(u.accessories);
    botEnsureToolEquipped(db, userId, u, inv);

    // 3) по желанию можем купить энергию, если не дотягиваем до цели
    if (!rt.energyTarget) rt.energyTarget = rint(6, energy.MAX_ENERGY);
    if (e < rt.energyTarget) botMaybeBuyEnergy(db, userId);

    // 4) копим до цели
    if (e < rt.energyTarget) return;

    if (e <= 0) {
      activity.log(userId, "lesson_no_energy", { e });
      return;
    }

    // достиг цели — на следующий цикл новая цель
    rt.energyTarget = rint(6, energy.MAX_ENERGY);

    const lessonNum = Number(u.current_lesson || 1);
    const taskIndex = Number(u.current_task || 0);

    const tasks = lessons[String(lessonNum)];
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    // ---- завершение урока ----
    if (taskIndex >= tasks.length) {
      const coinsAdd = rint(35, 70);
      const xpAdd = rint(8, 16);

      let c = safeParse(u.chests, []);
      let k = safeParse(u.keys, []);

      if (lessonNum % 5 === 0 && chance(0.85)) {
        const loot = chests.generateBossLoot(lessonNum);
        const rawR = loot?.rarity ?? loot?.r ?? "common";
        const r = String(rawR).toLowerCase();
        if (loot?.type === "chest") c.push({ r });
        if (loot?.type === "key") k.push(r);
        activity.log(userId, "boss_loot", { type: loot.type, r });
      }

      db.run(
        "UPDATE users SET current_lesson=current_lesson+1, current_task=0, level=level+1, coins=coins+?, xp=xp+?, chests=?, keys=? WHERE id=?",
        [coinsAdd, xpAdd, JSON.stringify(c), JSON.stringify(k), userId],
        () => activity.log(userId, "lesson_complete", { lesson: lessonNum, coinsAdd, xpAdd })
      );
      return;
    }

    const task = tasks[taskIndex];
    if (!task) return;

    // ---- подготовка тулса ----
    const eq = normalizeEquipped(u.equipped);
    const toolId = eq.tool;
    const eff = toolEffect(toolId);

    const hasTool = !!(toolId && eff && canUseTool(inv, toolId));
    const durCost = hasTool ? toolDurCost(toolId) : 0;

    // базовый шанс ответа
    const base = userId === -101 ? 0.72 : userId === -102 ? 0.62 : 0.8;
    const drift = (Math.random() - 0.5) * 0.18;
    let correctChance = clamp(base + drift, 0.45, 0.88);

    // ---- умное решение: использовать ли тулс ----
    const lowEnergy = e <= 2;
    const veryLowEnergy = e <= 1;

    let wantUseTool = false;
    if (hasTool) {
      let pUse = 0.06 + rt.mood * 0.08; // 6..14%
      if (lowEnergy) pUse += 0.20;
      if (veryLowEnergy) pUse += 0.12;
      if (correctChance < 0.62) pUse += 0.10;

      if (eff === "tool_show_answer") pUse += 0.10;
      if (eff === "tool_retry_once") pUse += 0.08;
      if (eff === "tool_skip_free") pUse += 0.06;

      pUse = clamp(pUse, 0, 0.55);
      wantUseTool = chance(pUse);
    }

    // ---- эффект тулса ----
    let usedTool = false;
    let toolMeta = null;

    if (wantUseTool && hasTool && eff === "tool_skip_free") {
      usedTool = true;
      toolMeta = { tool: toolId, eff, cost: durCost };

      decDurability(inv, toolId, durCost);
      db.run(
        "UPDATE users SET current_task=current_task+1, accessories=? WHERE id=?",
        [JSON.stringify(inv), userId],
        () => activity.log(userId, "tool_use", { ...toolMeta, action: "skip_free", lesson: lessonNum, task: taskIndex + 1 })
      );
      return;
    }

    if (wantUseTool && hasTool && eff === "tool_show_answer") {
      usedTool = true;
      toolMeta = { tool: toolId, eff, cost: durCost };
      correctChance = 0.999;
    }

    if (
      wantUseTool &&
      hasTool &&
      (eff === "tool_remove_1" || eff === "tool_remove_2" || eff === "tool_hint_first_letter" || eff === "tool_shuffle_options")
    ) {
      usedTool = true;
      toolMeta = { tool: toolId, eff, cost: durCost };
      const bump =
        eff === "tool_remove_2" ? 0.22 :
        eff === "tool_remove_1" ? 0.14 :
        eff === "tool_hint_first_letter" ? 0.10 :
        0.06;
      correctChance = clamp(correctChance + bump, 0, 0.97);
    }

    const canRetry = wantUseTool && hasTool && eff === "tool_retry_once";
    if (canRetry) {
      usedTool = true;
      toolMeta = { tool: toolId, eff, cost: durCost };
      correctChance = clamp(correctChance + 0.06, 0, 0.95);
    }

    // ---- ответ ----
    let isCorrect = chance(correctChance);

    if (!isCorrect && canRetry) {
      const secondChance = clamp(correctChance + 0.22, 0, 0.985);
      isCorrect = chance(secondChance);
      if (isCorrect) {
        if (usedTool) {
          decDurability(inv, toolId, durCost);
          db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), userId]);
          activity.log(userId, "tool_use", { ...toolMeta, action: "retry_saved", lesson: lessonNum, task: taskIndex + 1 });
        }

        db.run("UPDATE users SET current_task=current_task+1, energy=?, energy_ts=? WHERE id=?", [e, ts, userId], () => {
          activity.log(userId, "lesson_answer_ok", { lesson: lessonNum, task: taskIndex + 1, e });
        });
        return;
      }
    }

    if (isCorrect) {
      if (usedTool) {
        decDurability(inv, toolId, durCost);
        db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), userId]);
        activity.log(userId, "tool_use", { ...toolMeta, action: "assist", lesson: lessonNum, task: taskIndex + 1 });
      }

      db.run("UPDATE users SET current_task=current_task+1, energy=?, energy_ts=? WHERE id=?", [e, ts, userId], () => {
        activity.log(userId, "lesson_answer_ok", { lesson: lessonNum, task: taskIndex + 1, e });
      });
      return;
    }

    const spent = energy.spendEnergy(e, ts);
    e = spent.energy;
    ts = spent.energy_ts;

    if (usedTool) {
      decDurability(inv, toolId, durCost);
      db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), userId]);
      activity.log(userId, "tool_use", { ...toolMeta, action: "assist_fail", lesson: lessonNum, task: taskIndex + 1 });
    }

    db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, userId], () => {
      activity.log(userId, "lesson_answer_bad", { lesson: lessonNum, task: taskIndex + 1, e });
    });
  });
}

// -----------------------------
// CHESTS / TOOLS SHOP / MARKET
// -----------------------------
function botOpenChest(db, userId) {
  db.get("SELECT * FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const c = safeParse(u.chests, []);
    const k = safeParse(u.keys, []);
    if (!c.length || !k.length) return;

    const chestIndex = rint(0, c.length - 1);
    const chest = c[chestIndex];
    const chestR = String(chest?.r || "common").toLowerCase();

    const keyIndex =
      typeof chests.pickBestKeyIndex === "function"
        ? chests.pickBestKeyIndex(k, chestR)
        : k.findIndex((kr) => chests.canOpen(chestR, kr));
    if (keyIndex === -1) return;

    c.splice(chestIndex, 1);
    const usedKey = k.splice(keyIndex, 1)[0];

    const rw = chests.getChestReward(chestR);
    const inv = normalizeInv(u.accessories);

    let coins = Number(u.coins || 0);
    if (rw.type === "coins") coins += Number(rw.amount || 0);
    if (rw.type === "item" && rw.id) addItem(inv, rw.id, 10);

    db.run(
      "UPDATE users SET chests=?, keys=?, accessories=?, coins=? WHERE id=?",
      [JSON.stringify(c), JSON.stringify(k), JSON.stringify(inv), coins, userId],
      () =>
        activity.log(userId, "chest_open", {
          chestR,
          usedKey,
          rw: rw.type === "coins" ? `coins:${rw.amount}` : `item:${rw.id}`,
        })
    );
  });
}

function botBuyTool(db, userId) {
  db.get("SELECT tokens, accessories, equipped FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const tokens = Number(u.tokens || 0);
    if (tokens <= TOKENS_RESERVE) return;

    const affordable = tools.filter(
      (t) => t && Number(t.tokenPrice || 0) > 0 && Number(t.tokenPrice) <= (tokens - TOKENS_RESERVE)
    );
    if (!affordable.length) return;

    const t = pick(affordable);
    const inv = normalizeInv(u.accessories);
    addItem(inv, t.id, 10);

    db.run("UPDATE users SET tokens=tokens-?, accessories=? WHERE id=?", [Number(t.tokenPrice), JSON.stringify(inv), userId], () => {
      activity.log(userId, "buy_tool", { tool: t.id, cost: t.tokenPrice });

      // ✅ после покупки можем сразу авто-экипнуть (если слот пуст/сломано)
      botEnsureToolEquipped(db, userId, u, inv);
    });
  });
}

function botListItemOnMarket(db, userId) {
  db.get("SELECT accessories FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const rt = getRt(userId);
    if (now() < (rt.nextTradeAt || 0)) return;

    const inv = normalizeInv(u.accessories);
    const sellable = inv
      .filter((x) => x && x.id)
      .map((x) => ({ id: x.id, d: Number.isFinite(x.d) ? x.d : 10 }))
      .filter((x) => x.d > 0);
    if (!sellable.length) return;

    const it = pick(sellable);
    const currency = chance(0.14) ? "tokens" : "coins";

    const price =
      currency === "tokens"
        ? clampPriceTokens(Math.max(1, Math.round(calcLogicalMarketPrice(it.id, it.d) / 120)))
        : clampPriceCoins(calcLogicalMarketPrice(it.id, it.d));

    const ok = removeOneItem(inv, it.id);
    if (!ok) return;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), userId], (e1) => {
        if (e1) return db.run("ROLLBACK");

        db.run(
          "INSERT INTO market (seller_id, item_id, item_d, currency, price, created_at) VALUES (?, ?, ?, ?, ?, strftime('%s','now'))",
          [userId, it.id, it.d, currency, price],
          (e2) => {
            if (e2) return db.run("ROLLBACK");
            db.run("COMMIT", () => {
              rt.nextTradeAt = now() + TRADE_COOLDOWN_SEC + rint(0, 90);
              activity.log(userId, "market_list", { item: it.id, d: it.d, price, cur: currency });
            });
          }
        );
      });
    });
  });
}

function botBuyFromMarket(db, userId) {
  db.get("SELECT coins, tokens, accessories FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const rt = getRt(userId);
    if (now() < (rt.nextTradeAt || 0)) return;

    const coins = Number(u.coins || 0);
    const tokens = Number(u.tokens || 0);

    db.all("SELECT * FROM market ORDER BY RANDOM() LIMIT 10", [], (e2, lots) => {
      const list = (lots || []).filter((l) => l && l.seller_id !== userId);
      if (!list.length) return;

      for (const lot of list) {
        const cur = lot.currency || "coins";
        const price = Number(lot.price || 0);
        if (price <= 0) continue;

        if (cur === "coins") {
          if (price > MAX_COIN_PRICE) continue;
          if (coins - price < COINS_RESERVE) continue;
          if (coins < price) continue;
        } else {
          if (price > MAX_TOKEN_PRICE) continue;
          if (tokens - price < TOKENS_RESERVE) continue;
          if (tokens < price) continue;
        }

        const sp = shopPriceSafe(lot.item_id);
        const sys = priceToSystemSafe(lot.item_id, Number(lot.item_d || 10));

        if (cur === "coins") {
          if (sp && price > sp) continue;
          if (price < sys) continue;
        }

        const estSellCoins = calcLogicalMarketPrice(lot.item_id, Number(lot.item_d || 10));
        if (cur === "coins") {
          const need = Math.ceil(estSellCoins * (1 - MIN_PROFIT_PCT));
          if (price > need) continue;
        } else {
          const estSellTokens = clampPriceTokens(Math.max(1, Math.round(estSellCoins / 120)));
          const need = Math.max(1, Math.floor(estSellTokens * (1 - MIN_PROFIT_PCT)));
          if (price > need) continue;
        }

        const inv = normalizeInv(u.accessories);
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
          db.run(buyerUpdate, [price, JSON.stringify(inv), userId], (e3) => {
            if (e3) return db.run("ROLLBACK");
            db.run(sellerUpdate, [price, lot.seller_id], (e4) => {
              if (e4) return db.run("ROLLBACK");
              db.run("DELETE FROM market WHERE lot_id=?", [lot.lot_id], (e5) => {
                if (e5) return db.run("ROLLBACK");
                db.run("COMMIT", () => {
                  rt.nextTradeAt = now() + TRADE_COOLDOWN_SEC + rint(0, 120);
                  activity.log(userId, "market_buy", { lot: lot.lot_id, item: lot.item_id, price, cur });
                });
              });
            });
          });
        });

        return;
      }
    });
  });
}

function botSellToSystem(db, userId) {
  db.get("SELECT accessories FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const rt = getRt(userId);
    if (now() < (rt.nextTradeAt || 0)) return;

    const inv = normalizeInv(u.accessories);
    if (!inv.length) return;

    const sellable = inv
      .filter((x) => x && x.id)
      .map((x) => ({ id: x.id, d: Number.isFinite(x.d) ? x.d : 10 }))
      .filter((x) => x.d > 0);
    if (!sellable.length) return;

    const it = pick(sellable);
    const price = priceToSystemSafe(it.id, it.d);
    if (price <= 0) return;

    const ok = removeOneItem(inv, it.id);
    if (!ok) return;

    db.run("UPDATE users SET coins=coins+?, accessories=? WHERE id=?", [price, JSON.stringify(inv), userId], () => {
      rt.nextTradeAt = now() + TRADE_COOLDOWN_SEC + rint(0, 90);
      activity.log(userId, "system_sell", { item: it.id, d: it.d, price });
    });
  });
}

// -----------------------------
// TICK
// -----------------------------
function botTick(db, botId) {
  const rt = getRt(botId);

  if (rt.pauseLeft > 0) {
    rt.pauseLeft -= 1;
    activity.log(botId, "pause");
    return;
  }

  rt.burstLeft -= 1;
  if (rt.burstLeft <= 0) rerollCycle(rt);

  const wLesson = 0.42 + rt.mood * 0.18;
  const wEnergy = 0.10;
  const wChest = 0.07;
  const wList = 0.16;
  const wBuy = 0.16;
  const wSystem = 0.07;
  const wTool = 0.06;

  const roll = Math.random();
  let acc = 0;

  acc += wLesson;
  if (roll < acc) return botDoLesson(db, botId);

  acc += wEnergy;
  if (roll < acc) return botMaybeBuyEnergy(db, botId);

  acc += wChest;
  if (roll < acc) return botOpenChest(db, botId);

  acc += wList;
  if (roll < acc) return botListItemOnMarket(db, botId);

  acc += wBuy;
  if (roll < acc) return botBuyFromMarket(db, botId);

  acc += wSystem;
  if (roll < acc) return botSellToSystem(db, botId);

  return botBuyTool(db, botId);
}

function startBots(db) {
  ensureBots(db);

  const cfg = {
    [-101]: { baseMs: 9000, jitterMs: 9000 },
    [-102]: { baseMs: 8000, jitterMs: 11000 },
    [-103]: { baseMs: 7000, jitterMs: 8000 },
  };

  for (const b of BOT_PLAYERS) {
    const c = cfg[b.id] || { baseMs: 9000, jitterMs: 9000 };

    const run = () => {
      try {
        botTick(db, b.id);
        if (chance(0.18)) botTick(db, b.id);
      } catch (e) {
        console.error("botTick error:", e);
      } finally {
        const nextMs = c.baseMs + rint(0, c.jitterMs);
        const extraPause = chance(0.08) ? rint(15000, 65000) : 0;
        setTimeout(run, nextMs + extraPause);
      }
    };

    setTimeout(run, rint(1000, 12000));
  }
}

module.exports = {
  startBots,
  ensureBots,
  BOT_PLAYERS,
};
